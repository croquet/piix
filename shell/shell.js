/* globals Croquet */
/* eslint-disable no-template-curly-in-string */

class TransformModel {
    init() {
        /*
        this.subscribe(this.id, "newIFrame", "newIFrame");
        this.subscribe(this.id, "newImage", "newImage");
        this.subscribe(this.id, "newText", "newText");
        */

        this.subscribe(this.id, "viewport", "viewport");
        this.subscribe(this.sessionId, "viewPointerMoved", "pointerMoved");

        /*
        this.subscribe(this.id, "startPresentation", "startPresentation");
        this.subscribe(this.id, "stopPresentation", "stopPresentation");
        this.subscribe(this.id, "forceStopPresentation", "forceStopPresentation");
        this.subscribe(this.id, "setFollowing", "setFollowing");
        */

        this.subscribe(this.sessionId, "view-join", "addUser");
        this.subscribe(this.sessionId, "view-exit", "deleteUser");

        this.subscribe(this.sessionId, "localUserJoin", "localUserJoin");

        this.ensureClientViewRecords();

        console.log("TransformModel.init");
    }

    // the clientViewRecords structure is keyed by viewId.  for each client it holds
    //   lastViewport: last announced scalerRect
    //   lastPointer: last known x, y and target for the pointer
    //   lastActive: teatime of last significant update (viewport or pointer)
    //   active: whether now to be considered active
    ensureClientViewRecords() {
        if (this._get("clientViewRecords")) return;

        // console.log("init clientViewRecords");
        this._set("clientViewRecords", {});
        this._set("presentingViewId", null);
        this.future(500).call("TransformModel", "checkForInactiveClients");
    }

    addUser(viewId) {
        let clientViewRecords = this._get("clientViewRecords");
        let newValue = {...clientViewRecords};
        newValue[viewId] = {}; // just set up the entry
        this._set("clientViewRecords", newValue);
        console.log("TransformModel.addUser", newValue);
        this.publish(this.id, "addUser", viewId); // subscribed by transformView
    }

    deleteUser(viewId) {
        let clientViewRecords = this._get("clientViewRecords");
        let newValue = {...clientViewRecords};
        delete newValue[viewId];
        this._set("clientViewRecords", newValue);
        console.log("TransformModel.deleteUser", newValue);
        let presenterId = this._get("presentingViewId");
        if (presenterId === viewId) {
            this._set("presentingViewId", null);
            this.publish(this.sessionId, "presentationStopped");
        }
        this.publish(this.id, "deleteUser", viewId); // subscribed by transformView
    }

    localUserJoin(viewId) {
        // only for the ?isLocal case
        this.addUser(viewId);
        console.log("localUserJoin", viewId);
    }

    editClientViewRecord(viewId, fn, activateIfNeeded) {
        // fn will be supplied a clone of the record corresponding to the viewId,
        // and should update it in place.
        // return true if the edit takes place, false if viewId was not found.
        let clientViewRecords = this._get("clientViewRecords");
        let viewRecord = clientViewRecords[viewId];
        if (viewRecord === undefined) return false;

        let newValue = {...clientViewRecords};
        let newRecord = {...viewRecord};
        if (fn) fn(newRecord);
        if (activateIfNeeded && !newRecord.active) {
            newRecord.active = true;
            newRecord.lastActive = this.now();
            this.publish(this.sessionId, "userCursorUpdated", viewId);
        }
        newValue[viewId] = newRecord;
        this._set("clientViewRecords", newValue);
        return true;
    }

    checkForInactiveClients() {
        let clientViewRecords = this._get("clientViewRecords");
        Object.keys(clientViewRecords).forEach(viewId => {
            let viewRecord = clientViewRecords[viewId];
            let { lastActive, active } = viewRecord;
            // a client that has no active status, one way or the other, is
            // presumed active but the clock starts ticking immediately.
            if (active === undefined) {
                this.editClientViewRecord(viewId, null, true); // just activate
            } else if (active && this.now() - lastActive > 5000) {
                this.editClientViewRecord(viewId, record => record.active = false);
                this.publish(this.sessionId, "userCursorUpdated", viewId);
            }
        });

        this.future(500).call("TransformModel", "checkForInactiveClients");
    }

    pointerMoved(data) {
        // record and handle a viewPointerMoved message
        let { viewId, ...pointer } = data;
        let found = this.editClientViewRecord(viewId, record => record.lastPointer = pointer, true); // activate if needed
        if (!found) {return;}

        this.publish(this.id, "pointerMoved", data); // subscribed by transformView
    }

    viewport(data) {
        // store every change for which we know there's a view
        let { viewId, scalerRect } = data;
        let found = this.editClientViewRecord(viewId, record => record.lastViewport = scalerRect, true); // activate if needed
        if (!found) {return;}

        // when the moving view is the presenter, automatically update
        // viewport records of all views that we believe are following.
        let presenterId = this._get("presentingViewId"); // or null
        if (viewId === presenterId) {
            let clientViewRecords = this._get("clientViewRecords");
            Object.keys(clientViewRecords).forEach(viewId2 => {
                if (viewId2 !== presenterId) {
                    let record = clientViewRecords[viewId2];
                    if (record.isFollowing) {
                        this.editClientViewRecord(viewId2, rec => rec.lastViewport = {...scalerRect});
                    }
                }
            });
        }
        this.publish(this.id, "viewportChanged", data); // subscribed by transformView
    }

    startPresentation(requestingId) {
        // reject if there is already a view presenting
        let presenterId = this._get("presentingViewId");
        if (presenterId) {
            console.warn(`${requestingId} can't present while ${presenterId} is presenting`);
            return;
        }
        console.log(`${requestingId} starting presentation`);
        this._set("presentingViewId", requestingId);

        // start by assuming that all other views are following.  any
        // of them can opt out later if the user wants.
        let clientViewRecords = this._get("clientViewRecords");
        Object.keys(clientViewRecords).forEach(viewId => {
            if (viewId !== requestingId) this.setFollowing({ viewId, isFollowing: true });
        });

        this.publish(this.sessionId, "presentationStarted"); // to view
        this.publish(this.sessionId, "allUserCursorsUpdated");
    }

    forceStopPresentation(requestingId) {
        this.stopPresentation(requestingId, true);
    }

    stopPresentation(requestingId, force) {
        // reject if the view is somehow already not presenting, or force it if force is true
        let presenterId = this._get("presentingViewId");
        if (!force && (presenterId !== requestingId)) {
            console.warn(`rejecting ${requestingId} request to stop presenting; presenter is ${presenterId}`);
            return;
        }
        console.log(`${requestingId} stopping presentation`);
        this._set("presentingViewId", null);

        // mark all other views as not following anyone
        let clientViewRecords = this._get("clientViewRecords");
        Object.keys(clientViewRecords).forEach(viewId => {
            if (viewId !== requestingId) this.setFollowing({ viewId, isFollowing: false });
        });

        this.publish(this.sessionId, "presentationStopped"); // to view
        this.publish(this.sessionId, "allUserCursorsUpdated");
    }

    setFollowing(data) {
        // either invoked directly by the model, at start or stop of
        // a presentation, or in response to an individual client
        // announcing that it is following (or not) the presenter.
        let { viewId, isFollowing } = data;

        // if there is no presenter, make sure we're not accidentally
        // setting isFollowing to true.
        let presenterId = this._get("presentingViewId");
        if (!presenterId) isFollowing = false;

        if (isFollowing) {
            let clientViewRecords = this._get("clientViewRecords");
            let scalerRect = clientViewRecords[presenterId].lastViewport;
            this.editClientViewRecord(viewId, record => {
                record.isFollowing = true;
                record.lastViewport = {...scalerRect};
            });
        } else {
            this.editClientViewRecord(viewId, record => record.isFollowing = false);
        }
    }

    addFrame(frame) {
        let scaler = this.querySelector("#scaler");
        if (scaler) {
            scaler.call("PasteUpModel", "addFrame", frame);
        }
    }

    newImage(_asset) {
    }

    newText(_info) {
    }

    newIFrame(_info) {
    }
}

class TransformView {
    init() {
        /*
        this.subscribe(this.sessionId, "toolButtonPressed", "toolButtonPressed");
        this.subscribe(this.sessionId, "followButton", "followButtonPressed");
        */

        this.subscribe(this.model.id, "addUser", "addUser");
        this.subscribe(this.model.id, "deleteUser", "deleteUser");

        /*
        this.subscribe(this.sessionId, "presentationStarted", "presentationStarted");
        this.subscribe(this.sessionId, "presentationStopped", "presentationStopped");

        */
        this.subscribe(this.model.id, "pointerMoved", "pointerMoved");
        this.subscribe(this.model.id, "viewportChanged", "viewportChanged");

        /*
        this.subscribe(this.sessionId, "favoritesChanged", "favoritesChanged"); // published by PasteUpModel and PasteUpView
        this.subscribe(this.sessionId, { event: "userAppsChanged", handling: "immediate" }, "TransformView.userAppsChanged"); // published by PasteUpView.  immediate to allow instant highlighting during a drag operation.
        this.subscribe(this.sessionId, "sessionAppUpdated", "sessionAppUpdated"); // published by PasteUpModel

        this.subscribe(this.sessionId, "zoomInButton", "zoomInButtonPressed");
        this.subscribe(this.sessionId, "zoomOutButton", "zoomOutButtonPressed");
        this.subscribe(this.sessionId, "recenterButton", "homeButtonPressed");

        */
        this.subscribe(this.sessionId, "localWindowResized", "windowResize");

        /*
        this.subscribe(this.sessionId, "annotationButton", "annotationButtonPressed");
        this.subscribe(this.sessionId, "annotationDone", "annotationDone");
        */

        this.following = null;

        // plug this object/trait into the topView as the means of accessing
        // viewport and presenter details.
        window.topView.viewportTracker = {
            target: this,
            trait: "TransformView",
            getPresenter: "getPresenter",
            getViewDetails: "getViewDetails"
        };

        window.topView.requestInitialization(this, "TransformView", "setup");
        console.log("TransformView.init");
    }

    setup() {
        let scalerKey = this.dom.querySelector("#scaler").key;
        this.scaler = window.views[scalerKey];

        this.scaler.currentZoom = 1;
        this.scrollToHome(true);

        this.dom.addEventListener("pointerdown", (evt) => this.pointerDown(evt), true);
        this.dom.addEventListener("dblclick", (evt) => this.dblClick(evt));
        this.dom.addEventListener("wheel", (evt) => this.wheel(evt)); //, true);
        this.dom.addEventListener("scroll", evt => this.scroll(evt));

        let canv = this.followCanvas = document.createElement("canvas");
        canv.width = canv.height = this.followCanvasWidth = this.followCanvasHeight = 1000;
        canv.style.width = "100%";
        canv.style.height = "100%";
        canv.style.position = "absolute";
        canv.style.pointerEvents = "none";
        this.dom.parentNode.appendChild(canv);

        this.updateAllPointers();

        let presenterId = this.getPresenter();
        if (presenterId) {
            this.joinPresentation(true); // tellModel
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures
        this.evCache = [];
        this.origDiff = -1;
        this.origZoom = 1;
        this.noDrag = false;

        this.hasPendingAppsUpdate = false;
        this.resetToolState();

        this.setupFontStyle();

        window.document.fonts.ready.then(() => {
            window.topView.setLastFontLoadedTime(Date.now());
        });
        this.setRoomName();
        this.windowResize(true);
    }

    setRoomName() {
        let roomName = window.topView.querySelector("#roomName");
        if (roomName && window.fromLandingPage) {
            roomName.call("RoomNameView", "setName", window.fromLandingPage.boardName);
        }
    }

    setupFontStyle() {
        // it is a bit of a hack as the directory in styleString may disappear after installing a new version

        let commit = window._production ? window._production : "./";
        let style = document.createElement("style");
        style.innerHTML = `
@font-face {
    font-family: 'Poppins';
}
`;
        document.body.appendChild(style);
    }


    dblClick(_evt) {
    }

    addUser(_viewId) {
        // just here for symmetry with deleteUser
    }

    deleteUser(viewId) {
        this.deletePointer(viewId);
    }

    windowResize(_firstTime) {
        if (!this.scaler) return; // setup hasn't happened yet

        let rect = this.dom.getBoundingClientRect();
        this.adjustHeaderPosition();

        if (this.scaler.model._get("initialAppCreated")) {
            this.scaler.call("PasteUpView", "resizeDefaultApp", rect.width, rect.height);
        }
    }

    adjustHeaderPosition() {
        let header = window.topView.querySelector("#header");
        let peers = window.topView.querySelector("#peers");
        if (header) {
            let rect = this.dom.getBoundingClientRect();
            let pRect = peers.dom.getBoundingClientRect();
            let hRect = header.dom.getBoundingClientRect();
            let available = rect.width - pRect.width;
            let left = ((available - hRect.width) / 2);

            header.dom.style.setProperty("max-width", `${available}px`);
            if (left >= 0) {
                header.dom.style.setProperty("left", `${left}px`);
            } else {
                header.dom.style.setProperty("left", "0px");
            }

            let tooltip = header.querySelector("#participants-tooltip");
            if (tooltip) {
                let tRect = tooltip.dom.getBoundingClientRect();
                let tLeft = (hRect.width - tRect.width) / 2;
                tooltip.dom.style.setProperty("left", `${tLeft}`);
            }
        }
    }

    // return the current client coordinates of the visible board
    // area - as flanked by the header, the tools, the peers, and the
    // info bar.
    getVisibleClientRect() {
        let left, top;
        if (false) {
            // old screen setup: full-width header, full-height tools
            if (!this.toolsView) this.toolsView = window.topView.querySelector("#tools");
            left = this.toolsView.dom.getBoundingClientRect().right;

            if (!this.headerView) this.headerView = window.topView.querySelector("#header");
            top = this.headerView.dom.getBoundingClientRect().bottom;
        } else {
            // new: desktop extends to top and left
            let rect = this.dom.getBoundingClientRect();
            left = rect.left;
            top = rect.top;
        }

        if (!this.infoBarView) this.infoBarView = window.topView.querySelector("#infoBar");
        let bottom = this.infoBarView.dom.getBoundingClientRect().top;

        if (!this.peersView) this.peersView = window.topView.querySelector("#peers");
        let right = this.peersView.dom.getBoundingClientRect().left;

        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    // return the (unscaled) rectangle of the scaler now visible
    // in the board area.
    getVisibleScalerRect() {
        let rect = this.dom.getBoundingClientRect();
        let visibleRect = this.getVisibleClientRect();
        let translation = this.scaler.currentTranslation;
        let zoom = this.scaler.currentZoom;
        let left = (translation.x + visibleRect.x - rect.x) / zoom;
        let top = (translation.y + visibleRect.y - rect.y) / zoom;
        let width = visibleRect.width / zoom;
        let height = visibleRect.height / zoom;
        return { x: left, y: top, width, height };
    }

    jumpViewport(coord) {
        let {x, y} = coord;
        this.setScroll(x, y, true); // publish
    }

    scrollToHome(optOrigin) {
        let presenterId = this.getPresenter();
        if (presenterId && presenterId !== this.viewId && this.following) {
            this.adjustToFollowedViewport(true); // true => locally triggered change
            return;
        }

        this.zoom(1);

        let sRect = this.scaler.dom.getBoundingClientRect();
        let rect = this.dom.getBoundingClientRect();
        let translationX = (sRect.width - rect.width) / 2;
        let translationY = (sRect.height - rect.height) / 2;
        if (optOrigin) {
            translationX = 0;
            translationY = 0;
        }

        this.setScroll(translationX, translationY, true);
    }

    homeButtonPressed() {
        this.scrollToHome();
    }

    dashboardButtonPressed() {
        let url = new URL(window.location.href);
        let team = url.searchParams.get("t");

        let newURL = `${url.origin}${url.pathname}?t=${team}`;
        window.open(newURL, "_blank");
    }

    radarButtonPressed() {
    }

    zoomInButtonPressed() {
        this.zoomAboutCenter(1.1);
    }

    zoomOutButtonPressed() {
        this.zoomAboutCenter(1 / 1.1);
    }

    zoomAboutCenter(changeRatio) {
        this.zoomAboutPoint(this.scaler.currentZoom * changeRatio);
    }

    zoomAboutPoint(desiredZoom, fixedClientX, fixedClientY) {
        let translation = this.scaler.currentTranslation;

        if (fixedClientX === undefined && fixedClientY === undefined) {
            // calculate the center point when arguments are not supplied
            let rect = this.dom.getBoundingClientRect();
            fixedClientX = rect.width / 2;
            fixedClientY = rect.height / 2;
        }

        let oldZoom = this.scaler.currentZoom;
        let newZoom = this.constrainedZoom(desiredZoom);
        if (newZoom !== oldZoom) {
            this.zoom(newZoom);

            // old coordinate, on the unzoomed scaler, of the
            // designated fixed point.
            let fixedX = (translation.x + fixedClientX) / oldZoom;
            let fixedY = (translation.y + fixedClientY) / oldZoom;

            // offset for the newly zoomed scaler, so the point
            // remains stationary in the client.
            translation = { x: fixedX * newZoom - fixedClientX, y: fixedY * newZoom - fixedClientY };
        }

        this.setScroll(translation.x, translation.y, true); // publish
    }

    followButtonPressed() {
        if (this.followMenu) {
            this.followMenu.remove();
            this.followMenu = null;
            return;
        }

        if (!this.following) {
            let b = window.topView.querySelector("#followButton");
            let users = this.model._get("clientViewRecords"); // viewId to record
            if (!users) {return;}
            let viewIds = Object.keys(users).filter(id => id !== this.viewId);
            let menu = this.makeFollowMenu(viewIds);
            menu.addEventListener("input", (evt) => this.followerSelected(evt));
            menu.style.setProperty("position", "absolute");
            let rect = b.dom.getBoundingClientRect();
            menu.style.setProperty("left", (rect.x + 20) + "px");
            menu.style.setProperty("top", (rect.y + 20) + "px");
            menu.style.setProperty("z-index", "10");
            this.followMenu = menu;
            b.dom.parentNode.appendChild(menu);
        } else {
            this.unfollow();
        }
    }

    makeFollowMenu(viewIds) {
        let select = document.createElement("select");
        select.size = "" + viewIds.length + 1;

        let title = document.createElement("option");
        title.disabled = true;
        title.selected = true;
        title.innerHTML = "Select the user to follow";
        title.style.setProperty("font-size", "20px");
        select.appendChild(title);

        viewIds.forEach((viewId) => {
            let opt = document.createElement("option");
            opt.innerHTML = this.scaler.call("PasteUpView", "getUserInfo", viewId).nickname || viewId;
            opt.value = viewId;
            opt.style.setProperty("font-size", "20px");
            select.appendChild(opt);
        });
        return select;
    }

    followerSelected(evt) {
        let viewId = evt.target.value;
        evt.target.remove();
        this.followMenu = null;

        // let followButton = window.topView.querySelector("#followButton");
        // followButton.call("ButtonView", "setButtonLabel", `Following: ${value}`, "black");
        this.follow(viewId);
    }

    getPresenter() {
        return this.model._get("presentingViewId");
    }

    getViewDetails(viewId) {
        let isLocal = viewId === this.viewId;
        let presenterId = this.getPresenter();
        let isPresenter = viewId === presenterId;
        let isFollower = presenterId && !isPresenter && !(isLocal && !this.following);
        let viewRecords = this.model._get("clientViewRecords");
        let isActive = viewRecords[viewId] && viewRecords[viewId].active;
        return { isLocal, isPresenter, isFollower, isActive };
    }

    presentationStarted() {
    }

    joinPresentation(_tellModel) {
    }

    presentationStopped() {
    }

    leavePresentation(_tellModel) {
    }

    follow(_viewId) {
    }

    unfollow() {
    }

    setPresenterString(_str, _color) {
    }

    requestToolsHidden(_bool) {
    }

    pointerDown(_evt) {
    }

    pointerMove(_evt) {
    }

    pointerUp(_evt) {
    }

    pointerLost(evt) {
        this.evCache = [];
        this.pointerUp(evt);
    }

    wheel(evt) {
        if (this.scaler && this.scaler.model._get("initialAppCreated")) {return;}
        evt.preventDefault();
        evt.stopPropagation();
    }

    constrainedZoom(desiredZoom) {
        let sWidth = this.scaler.model._get("boardWidth");
        let sHeight = this.scaler.model._get("boardHeight");
        let rect = this.dom.getBoundingClientRect();

        let newZoom = Math.min(desiredZoom, 16); // arbitrary choice;
        newZoom = Math.max(newZoom, rect.width / sWidth, rect.height / sHeight);

        return newZoom;
    }

    deletePointer(viewId) {
        window.topView.pluggableDispatch("pointerTracker", "deletePointer", viewId);
    }

    pointerMoved(info) {
        // handle a pointerMoved event from the TransformModel, or a call from
        // updateAllPointers.
        window.topView.pluggableDispatch("pointerTracker", "pointerMoved", info);
    }

    updateAllPointers() {
        let viewRecords = this.model._get("clientViewRecords");
        Object.keys(viewRecords).forEach(viewId => {
            let record = viewRecords[viewId];
            if (record.lastPointer) this.pointerMoved({viewId, ...record.lastPointer});
        });
    }

    viewportChanged(data) {
        if (data.viewId === this.viewId) return;

        if (data.viewId === this.following) this.adjustToFollowedViewport();
    }

    adjustToFollowedViewport(isLocal = false) {
        if (!this.following) return;
        let clientViewRecords = this.model._get("clientViewRecords");
        if (!clientViewRecords) return;
        let record = clientViewRecords[this.following];
        if (!record) return;
        let scalerRect = record.lastViewport;
        if (!scalerRect) return;

        // in general, moving to follow a remote presenter should
        // not invalidate this user's viewport-restore record.
        // isLocal is true iff this was a locally triggered move (by
        // pressing the recenter button), which *should* therefore
        // allow the record to be removed as usual by setScroll.
        let restoreSpecBackup = this.viewportRestoreSpec;
        let rect = this.dom.getBoundingClientRect();
        let { zoom: newZoom, translation: newTranslation } = this.setViewportToRect(scalerRect, false); // don't publish
        if (!isLocal) this.viewportRestoreSpec = restoreSpecBackup;

        // display a mask to show the region being seen by the followee
        let canv = this.followCanvas;
        // eslint-disable-next-line no-self-assign
        canv.width = canv.width; // clear
        let ctx = canv.getContext("2d");

        let fcWidth = this.followCanvasWidth;
        let fcHeight = this.followCanvasHeight;

        // stackoverflow.com/questions/13618844/polygon-with-a-hole-in-the-middle-with-html5s-canvas
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.rect(0, 0, fcWidth, fcHeight); // outer

        let innerLeft = Math.max(0, (scalerRect.x * newZoom - newTranslation.x) / rect.width * fcWidth);
        let innerTop = Math.max(0, (scalerRect.y * newZoom - newTranslation.y) / rect.height * fcHeight);
        let innerWidth = Math.min(fcWidth - innerLeft, scalerRect.width * newZoom / rect.width * fcWidth);
        let innerHeight = Math.min(fcHeight - innerTop, scalerRect.height * newZoom / rect.height * fcHeight);
        ctx.moveTo(innerLeft, innerTop);
        ctx.rect(innerLeft, innerTop, innerWidth, innerHeight);

        ctx.fillStyle = "black"; // "rgba(150, 150, 150, 0.75)";
        ctx.fill('evenodd');
    }

    setViewportToRect(scalerRect, publish = true) {
        // returns the new zoom and translation settings
        let rect = this.dom.getBoundingClientRect();
        let visibleRect = this.getVisibleClientRect();
        let oldZoom = this.scaler.currentZoom;

        // as far as possible (given the constraints of view sizes)
        // set the local zoom so the remote view just fits within
        // the local visible area, with the remote view's centre
        // coincident with this view's centre.
        let desiredZoom = Math.min(visibleRect.width / scalerRect.width, visibleRect.height / scalerRect.height);
        let newZoom = this.constrainedZoom(desiredZoom);
        if (newZoom !== oldZoom) this.zoom(newZoom);

        // coordinate of the remote view's centre on the unzoomed scaler.
        let centerX = scalerRect.x + scalerRect.width / 2;
        let centerY = scalerRect.y + scalerRect.height / 2;

        // client offset of the centre of the local view
        let clientCenterX = visibleRect.x + visibleRect.width / 2 - rect.x;
        let clientCenterY = visibleRect.y + visibleRect.height / 2 - rect.y;

        // zoomed-scaler origin needed to place the client centre appropriately
        let translationX = centerX * newZoom - clientCenterX;
        let translationY = centerY * newZoom - clientCenterY;

        return { zoom: newZoom, translation: this.setScroll(translationX, translationY, publish) };
    }

    setViewportFromFrame(frameId, scalerRect) {
        let restoreRect = this.getVisibleScalerRect();
        this.setViewportToRect(scalerRect); // also clears any previous viewportRestoreSpec
        this.viewportRestoreSpec = { frameId, scalerRect: restoreRect };
    }

    restoreViewportIfSameFrame(frameId) {
        let spec = this.viewportRestoreSpec; // { frameId, scalerRect }
        if (!spec || spec.frameId !== frameId) return false;

        this.setViewportToRect(spec.scalerRect); // also clears viewportRestoreSpec
        return true;
    }

    clearRestoreViewportIfSameFrame(frameId) {
        let spec = this.viewportRestoreSpec; // { frameId, scalerRect }
        if (!spec || spec.frameId !== frameId) return;

        this.viewportRestoreSpec = null;
    }

    urlFromTemplate(urlTemplate) {
        let SaverClass = this.model.getLibrary("boards.PasteUpSaver3");
        let saver = new SaverClass();
        return saver.urlFromTemplate(urlTemplate);
    }

    toolButtonPressed(_data) {
    }

    setToolState(_state) {
    }

    resetToolState() {
    }

    userAppsChanged() {
    }

    sessionAppUpdated(_appName) {
    }

    favoritesChanged(_appName) {
    }

    createObjectInRect(_unscaledRect) {
    }

    scroll(_evt) {
    }

    setScroll(x, y, publish) {
        let zoom = this.scaler.currentZoom;
        let thisRect = this.dom.getBoundingClientRect();

        // ensure that neither the top left nor bottom right corners
        // are outside the scaler limits (it's the caller's responsibility
        // to ensure that the zoom is suitable for the client size).
        if (x < 0) x = 0;
        else x = Math.min(x, this.scaler.model._get("boardWidth") * zoom - thisRect.width);

        if (y < 0) y = 0;
        else y = Math.min(y, this.scaler.model._get("boardHeight") * zoom - thisRect.height);

        // round, because the scroll properties only deal in integers (and floor/ceil
        // would introduce a cumulative bias)
        x = Math.round(x);
        y = Math.round(y);

        this.scaler.currentTranslation = { x, y };

        this.dom.scrollLeft = x;
        this.dom.scrollTop = y;

        if (publish) {
            window.topView.throttledInvoke("publishViewport", this.scaler.throttleBaseMS * 3, () => this.publishViewport());
        }

        this.updateAllPointers();

        this.viewportRestoreSpec = null;

        this.publish(this.sessionId, "annotationCleanAndDraw");
        return { x, y };
    }

    publishViewport() {
        let rect = this.getVisibleScalerRect();
        let { x, y, width, height } = rect;
        let truncated = { x: x | 0, y: y | 0, width: width | 0, height: height | 0 };
        this.publish(this.model.id, "viewport", { viewId: this.viewId, scalerRect: truncated });
    }

    zoom(z) {
        this.scaler.currentZoom = z;
        let prop = this.scaler.dom.style.getPropertyValue("transform");
        if (!prop) return;

        let matrix = prop.split(", ");
        if (matrix[0].startsWith("matrix(")) {
            matrix[0] = matrix[0].slice(7);
        }
        if (matrix[5].endsWith(")")) {
            matrix[5] = matrix[5].slice(0, matrix[5].length - 1);
        }
        let m = matrix.map(v => parseFloat(v));

        m[0] = z;
        m[3] = z;

        let newProp = `matrix(${m.join(", ")})`;
        this.scaler.dom.style.setProperty("transform", newProp);

        // force this element to take account of the change in size of the child.
        // on Safari, not doing this before setting the position (with scrollLeft
        // and scrollTop) appears to cause the browser to fail to notice that
        // scrollWidth needs recomputing.
        // sept 2020: additional step, to fix a further problem in Safari's
        // calculation of scrollWidth: it seems that if any descendant element has
        // position="fixed", scrollWidth isn't being updated.  we can make sure
        // that's not true for q's own objects, but iframes can have arbitrary
        // contents.  therefore temporarily remove iframes from the display tree
        // while scrollWidth is recalculated.
        let frames = Array.from(this.dom.querySelectorAll("iframe")).map(f => [f, f.style.display]);
        frames.forEach(([f, _]) => f.style.display = "none");

        // eslint-disable-next-line no-unused-expressions
        this.dom.scrollWidth;

        frames.forEach(([f, d]) => f.style.display = d);

        let rect = this.dom.getBoundingClientRect();
        this.publish(this.sessionId, "annotationResizeAndDraw", rect.width, rect.height);
    }

    annotationDone() {
    }

    annotationButtonPressed() {
    }

    startAnnotationDrawing() {
    }

    stopAnnotationDrawing() {
    }
}

class PasteUpModel {
    init() {
        // this.subscribe(this.id, "addAsset", "PasteUpModel.addAsset");
        // this.subscribe(this.id, "addImage", "PasteUpModel.addImage");
        // this.subscribe(this.id, "addURL", "PasteUpModel.addURL");
        // this.subscribe(this.id, "addPDF", "PasteUpModel.addPDF");

        this.subscribe(this.sessionId, "triggerPersist", "triggerPersist");

        this.subscribe(this.sessionId, "trashObject", "trashObject");
        this.subscribe(this.sessionId, "copyObject", "copyObject");
        this.subscribe(this.sessionId, "moveObjectEdges", "moveObjectEdges");
        this.subscribe(this.sessionId, "resizeOrMoveEnd", "resizeOrMoveEnd");
        this.subscribe(this.sessionId, "moveAndResizeObject", "moveAndResizeObject");
        this.subscribe(this.sessionId, "returnToPreviousState", "returnToPreviousState");
        this.subscribe(this.sessionId, "bringToFront", "bringToFront");
        this.subscribe(this.sessionId, "sendToBack", "sendToBack");
        this.subscribe(this.sessionId, "setFrameBorder", "setFrameBorder");
        this.subscribe(this.sessionId, "setLockFrame", "setLockFrame");
        this.subscribe(this.sessionId, "openWorkspace", "openWorkspace");

        this.subscribe(this.id, "setSessionFavorite", "setSessionFavorite");

        this.subscribe(this.id, "startScripting", "startScripting");

        this.subscribe(this.id, "setUserInfo", "setUserInfo");

        this.subscribe(this.sessionId, "view-join", "addUser");
        this.subscribe(this.sessionId, "view-exit", "deleteUser");

        // this.subscribe(this.id, 'saveRequest', 'save');
        this.subscribe(this.id, "loadContents", "loadDuplicate");

        this.subscribe(this.sessionId, "setBackground", "setBackground");

        this.ensureUserInfo();
        this.ensureLayers();
        this.ensureSessionApps();
        this.ensureSessionUtilities();
        this.ensureSessionFavorites();
        this.ensurePersistenceTimer();
        this.ensureScriptors();
        this.ensureInitialApp();
        console.log("PasteUpModel.init()");
    }

    ensureUserInfo() {
        if (!this._get("userInfo")) {
            this._set("userInfo", {});
        }
        return this._get("userInfo");
    }

    ensureLayers() {
        if (!this._get("layers")) {
            this._set("layers", []);
        }
        return this._get("layers");
    }

    // sept 2020: sessionFavorites is now (like wallet favorites) keyed
    // by url, with each entry having { appInfo, faveName }
    ensureSessionFavorites() {
        if (!this._get("sessionFavorites")) {
            this._set("sessionFavorites", {});
        }
        return this._get("sessionFavorites");
    }

    ensureSessionApps() {
        let create = false;
        let old = this._get("sessionApps");
        let check = () => {
            if (!old) {
                create = true;
                return;
            }
            let keys = Object.keys(old);
            if (keys.length === 0) {
                create = true;
                return;
            }
            let first = old[keys[0]];
            if (!first.order) {
                create = true;
            }
        };

        check();

        if (create) {
            // nov 2020: for now, the set of app buttons is fixed.
            let appDefs = {
                link: {
                    label: "web page", iconName: "link.svgIcon",
                    urlTemplate: "../cobrowser-single/?q=${q}", order: 10,
                    noURLEdit: true,
                    noSandbox: true,
                    pressHold: {
                        appName: "link:secondary", label: "custom app", iconName: "link.svgIcon",
                        urlTemplate: null, order: 1
                    }
                },
                // googleworkspace: {
                //     iconName: "googleworkspace.svgIcon",
                //     viewBox: [376, 177], urlTemplate: null, order: 15,
                // },
                docview: {
                    label: "document", iconName: "pdf.svgIcon",
                    urlTemplate: "../docview/?q=${q}", order: 20
                },
                pix: {
                    label: "pictures", iconName: "addimg.svgIcon",
                    urlTemplate: "../pix/?q=${q}", order: 30
                },
                text: {
                    label: "notes", iconName: "text-fields.svgIcon",
                    urlTemplate: "../text/apps/?q=${q}", order: 40
                },
                whiteboard: {
                    label: "whiteboard", iconName: "whiteboard.svgIcon",
                    urlTemplate: "../whiteboard/?q=${q}", order: 50
                },
                sharescreen: {
                    label: "share screen", iconName: "share-screen.svgIcon",
                    urlTemplate: "../share-screen/?q=${q}", order: 60
                },
                youtube: {
                    label: "youtube", iconName: "youtube.svgIcon",
                    urlTemplate: "../youtube/?q=${q}", order: 70
                },
            };
            this._set("sessionApps", appDefs);
        }
        return this._get("sessionApps");
    }

    ensureSessionUtilities() {
        if (!this._get("sessionUtilities")) {
            this._set("sessionUtilities", {});
        }
        return this._get("sessionUtilities");
    }

    ensurePersistenceTimer() {
        if (!this._get("persistPeriod")) {
            let period = 30 * 1000;
            this._set("persistPeriod", period);
            this._set("lastPersistTime", 0);
            this._set("persistPending", false);
        }
    }

    ensureScriptors() {
        if (!this._get("scriptors")) {
            this._set("scriptors", {});
        }
        return this._get("scriptors");
    }

    ensureInitialApp() {
        if (this.childNodes.length === 0 && !this._get("initialAppCreated")) {
            let pix = this.createElement();
            pix.domId = "pix";
            (new Function(this.getLibrary("pix2.initializeAsApp")))()(pix);
            pix._set("_useCustomSaver", ["PixModel", "persistentDataAsArray"]);
            pix._set("_useCustomLoader", ["PixModel", "loadPersistentDataAsArray"]);
            pix._set("_useCustomResizer", ["PixView", "resizeWindow"]);
            pix._set("_useCustomPointTransformer", ["PixView", "transformPoint"]);
            pix._set("_useCustomPointInverter", ["PixView", "invertPoint"]);

            this._set("initialAppCreated", pix.domId);
            let info = {
                x: 0,
                y: 0,
                width: 1000,
                height: 1000,
            };
            this.initialApp(pix, info);
        }
    }

    initialApp(app, info) {
        let {x, y, width, height} = info;
        let frame = this.createElement();
        frame.setCode("boards.FrameModel");
        frame.setViewCode("boards.FrameView");
        frame._set("hasAddressBar", false);

        app.style.setProperty("width", `${width}px`);
        app.style.setProperty("height", `${height}px`);
        frame.call("FrameModel", "setObject", app, {x, y});

        this.addFrame(frame);
    }

    chooseNewUserColor(numColors) {
        // create an array tallying existing assignment of colour
        // indices.  start by filling the array with the maximum
        // count each colour can have - for example, if there are
        // four available colours and there are six users, each
        // colour can have been used a maximum of two times.
        // ...except that, through the luck of joins and leaves,
        // this theoretical maximum *can* be exceeded (e.g., ten
        // users reducing to two, that happen to be the same colour).
        let userInfo = this._get("userInfo");
        let numUsers = Object.keys(userInfo).length + 1; // because we're about to add one
        let maxTally = Math.ceil(numUsers / numColors);
        let colorCands = new Array(numColors).fill(maxTally);
        Object.values(userInfo).forEach(record => {
            let colorIndex = record.userColorIndex;
            if (colorIndex !== undefined) colorCands[colorIndex]--;
        });
        // now gather the indices that have been used fewer than
        // the (theoretical) maximum number of times.  those are
        // the remaining candidates.
        let remainingCands = [];
        colorCands.forEach((tally, colorIndex) => { if (tally > 0) remainingCands.push(colorIndex); });
        // and pick one of those at random.  Replicated random.
        let colorChoice = remainingCands[Math.floor(Math.random() * remainingCands.length)];
        return colorChoice;
    }
    setUserInfo(info) {
        // update the record in "userInfo" for the user with the supplied viewId

        let { viewId, sessionName, ...recordUpdate } = info; // recordUpdate is a copy without the viewId
        this._set("sessionName", sessionName);

        // hack to prevent the local test view from storing its info
        if (viewId.startsWith("viewDomain")) {return;}

        if (!recordUpdate.userColor) {
            let colors = ["#1378a5", "#c71f3c", "#2f4858", "#6a3d9a", "#333F91", "#2ba249", "#275B33", "#cc7025", "#f15a3a", "#901940", "#3b0f30"];
            let colorIndex = this.chooseNewUserColor(colors.length);
            recordUpdate.userColorIndex = colorIndex;
            recordUpdate.userColor = colors[colorIndex];
        }
        let userInfo = this._get("userInfo");
        let existing = userInfo[viewId] || {};
        let newRecord = {...existing, ...recordUpdate}; // merge update into existing record, if any
        userInfo = {...userInfo, ...{[viewId]: newRecord}}; // and merge record into new userInfo
        this._set("userInfo", userInfo);
        this.publish(this.sessionId, "userCursorUpdated", viewId);
        this.publish(this.id, "userInfoChanged");
    }

    addUser(_viewId) {
    }

    deleteUser(viewId) {
        let userInfo = this._get("userInfo");
        let newValue = {...userInfo };
        delete newValue[viewId];
        this._set("userInfo", newValue);
        this.publish(this.id, "userInfoChanged");
    }

    trashObject(data) {
        let {target, _viewId} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                let layers = this._get("layers").slice();
                let layer = layers.findIndex((elem) => target.equals(elem));
                let origLength = layers.length;
                if (layer >= 0) {
                    layers.splice(layer, 1);
                    for (let i = layer; i < origLength - 1; i++) {
                        let c = this.getElement(layers[i]);
                        c.style.setProperty("z-index", `${i}`);
                    }
                    this._set("layers", layers);
                }
                obj.remove();
                this.publish(this.id, "trashObject", target);
                // this.triggerPersist();
            }
        }
    }

    copyObject(data) {
        let {target, _viewId} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                let SaverClass = this.getLibrary("boards.PasteUpSaver3");
                let saver = new SaverClass();
                let json = saver.save(this, [obj]);
                let newSet = saver.load(json, this);
                let newOne = newSet[0];
                let t = newOne.getTransform().slice();
                t[4] += 50;
                t[5] += 50;
                newOne.setTransform(t);
                this.addFrame(newOne);
                let newTarget = this.getElement(newOne._get("target"));
                this.comeUpFullyOnReload(newOne, newTarget);
            }
        }
    }

    setFrameBorder(data) {
        let {target, _viewId, flag} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                obj._set("showBorder", flag);
                obj.call("FrameModel", "stateChanged");
            }
        }
    }

    setLockFrame(data) {
        let {target, _viewId, flag} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                obj._set("locked", flag);
                obj.call("FrameModel", "stateChanged");
            }
        }
    }

    getMinObjectExtent() {
        return { x: 150, y: 85 }; // pad of 50, when frame title height is 35
    }

    moveObjectEdges(info) {
        let { updates: { top, bottom, left, right }, target, viewId: _viewId, frameInfo } = info;

        let targetObj = this.getElement(target);
        if (!targetObj) {
            console.log("target not found", target);
            return;
        }

        let frame = this.getElement(frameInfo);
        if (!frame) {
            console.log("frame not found", frameInfo);
            return;
        }

        // when left or top is specified, it is applied to the
        // offset of the frame.
        // when right or bottom is specified, it is used to adjust
        // the width and height of the embedded "target".

        let t = frame.getTransform().slice();
        let frameLeft = t[4];
        let frameTop = t[5];
        let titleHeight = frame.call("FrameModel", "getTitleHeight");
        let minObjectExtent = this.getMinObjectExtent();
        let minPadExtent = { x: minObjectExtent.x, y: minObjectExtent.y - titleHeight };
        let targetLeft = frameLeft,
            targetTop = frameTop + titleHeight;

        let targetWidth = parseFloat(targetObj.style.getPropertyValue("width"));
        let targetHeight = parseFloat(targetObj.style.getPropertyValue("height"));

        let setTransform = false;

        if (left !== undefined) {
            let targetRight = targetLeft + targetWidth;
            // constrain to min width, bearing in mind that
            // right might be increasing too
            frameLeft = Math.min(left, Math.max(targetRight, right || 0) - minPadExtent.x);
            targetLeft = frameLeft;
            t[4] = frameLeft;
            setTransform = true;
            targetWidth = targetRight - targetLeft;
        }

        if (right !== undefined) {
            let constrainedRight = Math.max(right, targetLeft + minPadExtent.x);
            targetWidth = constrainedRight - targetLeft;
        }

        if (top !== undefined) {
            let targetBottom = targetTop + targetHeight;
            // constrain to min pad height
            frameTop = Math.min(top, Math.max(targetBottom, bottom || 0) - minPadExtent.y - titleHeight);
            targetTop = frameTop + titleHeight;
            t[5] = frameTop;
            setTransform = true;
            targetHeight = targetBottom - targetTop;
        }

        if (bottom !== undefined) {
            let constrainedBottom = Math.max(bottom, targetTop + minPadExtent.y);
            targetHeight = constrainedBottom - targetTop;
        }

        if (setTransform) frame.setTransform(t);

        if (targetObj._get("_useSetExtent")) {
            targetObj.call(...targetObj._get("_useSetExtent"), targetWidth, targetHeight);
        } else {
            targetObj.style.setProperty("width", targetWidth + "px");
            targetObj.style.setProperty("height", targetHeight + "px");
        }
    }

    moveAndResizeObject(info) {
        // new object coordinates specified as x, y, width, height
        // in raw pad coordinates
        let {width, height, x, y, frameInfo, target, _viewId} = info;

        let frame = this.getElement(frameInfo);
        let obj = this.getElement(target);

        if (!obj) {
            console.log("target not found", target);
            return;
        }

        if (!frame) {
            console.flog("frame not found", frameInfo);
            return;
        }

        let t = frame.getTransform().slice();
        t[4] = x;
        t[5] = y;
        frame.setTransform(t);

        width = Math.max(width, 36);
        height = Math.max(height, 36);
        if (obj._get("_useSetExtent")) {
            obj.call(...obj._get("_useSetExtent"), width, height);
        } else {
            obj.style.setProperty("width", width + "px");
            obj.style.setProperty("height", height + "px");
        }
    }

    resizeOrMoveEnd(info) {
        // now that interaction with the object has stopped,
        // adjust its position if needed to bring all corners
        // within the bounds of the board.
        let frameInfo = info.frameInfo;

        let frame = this.getElement(frameInfo);
        if (!frame) {return;}
        let t = frame.getTransform().slice();

        let targetInfo = frame._get("target");
        if (!targetInfo) {return;}
        let target = this.getElement(targetInfo);

        let boardWidth = this._get("boardWidth");
        let boardHeight = this._get("boardHeight");

        let width = target ? parseFloat(target.style.getPropertyValue("width")) : 400;

        if (t[4] < 0) {
            t[4] = 0;
        }
        if (t[4] + width > boardWidth) {
            t[4] = boardWidth - width - 200;
        }
        if (t[5] < 0) {
            t[5] = 0;
        }
        if (t[5] + 200 > boardHeight) {
            t[5] = boardHeight - 200;
        }

        frame.setTransform(t);
    }

    returnToPreviousState() {
        let previousState = this._get("previousWindowState");
        if (!previousState) {return;}
        this.moveAndResizeObject(previousState);
    }

    bringToFront(data) {
        let {target, _viewId} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                let layers = this._get("layers").slice();
                let layer = layers.findIndex((elem) => target.equals(elem));
                let origLength = layers.length;
                if (layer >= 0) {
                    let elem = layers[layer];
                    layers.splice(layer, 1);
                    for (let i = layer; i < origLength - 1; i++) {
                        let c = this.getElement(layers[i]);
                        c.style.setProperty("z-index", `${i}`);
                    }
                    layers.push(elem);
                    obj.style.setProperty("z-index", `${layers.length - 1}`);
                    this._set("layers", layers);
                    return;
                }
                this.appendChild(obj);
            }
        }
    }

    sendToBack(data) {
        let {target, _viewId} = data;
        if (target) {
            let obj = this.getElement(target);
            if (obj) {
                let layers = this._get("layers").slice();
                let layer = layers.findIndex((elem) => target.equals(elem));
                // let origLength = layers.length;
                if (layer >= 0) {
                    let elem = layers[layer];
                    layers.splice(layer, 1);
                    layers.unshift(elem);
                    obj.style.setProperty("z-index", "0");
                    for (let i = 1; i < layer + 1; i++) {
                        let c = this.getElement(layers[i]);
                        c.style.setProperty("z-index", `${i}`);
                    }
                    this._set("layers", layers);
                    return;
                }
                this.insertFirst(obj);
            }
        }
    }

    setSessionFavorite(data) {
        // console.log("setSessionFavorite", data);

        let favorites = this._get("sessionFavorites");
        // clone, to remove risk of model corruption
        // through old references.
        let newFavorites = {};
        for (let [url, spec] of Object.entries(favorites)) {
            newFavorites[url] = {...spec};
        }

        let changing = true; // assume there will be a change
        let { url, status, appInfo, proposedName } = data;
        let { appName } = appInfo;
        let existing = newFavorites[url];

        // code below is adapted from WalletModel (in wallet.js).

        // handle deletion
        if (!status) {
            delete newFavorites[url];
            changing = !!existing;
        } else {
            // if the spec is the same as what is already recorded,
            // there will be no change.
            if (existing) {
                let { appInfo: { appName: origAppName }, faveName: origFaveName } = existing;
                changing = !(appName === origAppName && proposedName === origFaveName);
            }

            if (changing) {
                // either a new favourite, or changing the name of an
                // existing one.  tweak the name if necessary to ensure
                // no clash with another favourite for the same app.
                let siblingNames = Object.keys(newFavorites)
                    .map(itemUrl => {
                        if (itemUrl === url) return null;
                        let item = newFavorites[itemUrl];
                        return item.appInfo.appName === appName && item.faveName;
                    })
                    .filter(Boolean);
                let text = proposedName;
                let duplicateIndex = 0;
                while (siblingNames.includes(text)) {
                    text = `${proposedName} (${++duplicateIndex})`;
                }
                newFavorites[url] = { appInfo, faveName: text };

                // if this is the first favourite for a given app, add
                // that app to the sessionApps dictionary
                let knownApps = this._get("sessionApps");
                if (!knownApps[appName]) {
                    // again, clone for safety
                    let newApps = {};
                    for (let [name, spec] of Object.entries(knownApps)) {
                        newApps[name] = {...spec};
                    }

                    let { label, iconName, urlTemplate } = appInfo;
                    newApps[appName] = { label, iconName, urlTemplate };

                    this._set("sessionApps", newApps);
                    this.publish(this.sessionId, "sessionAppUpdated", appName);
                }
            }
        }

        this._set("sessionFavorites", newFavorites);
        if (changing) this.publish(this.sessionId, "favoritesChanged", appName);
    }

    addFrame(frame) {
        let layers = [...this._get("layers"), frame.asElementRef()];
        this._set("layers", layers);
        frame.style.setProperty("z-index", `${layers.length - 1}`);
        this.appendChild(frame);
        this.savePersistentData();
    }

    openWorkspace(info, maybeTextFrame) {
        let textFrame = maybeTextFrame || this.newNativeText({x: info.x + 200, y: info.y + 200, width: 400, height: 300});
        let text = textFrame.querySelector("#text");
        this.workspaceAccepted({ref: text.asElementRef(), text: undefined});

        let scriptors = {...this._get("scriptors")};
        scriptors[text.asElementRef().asKey()] = {
            textFrameRef: textFrame.asElementRef(),
        };
        this.subscribe(text.id, "text", "PasteUpModel.workspaceAccepted");
    }

    workspaceAccepted(data) {
        let {ref, text} = data;

        let elem = this.getElement(ref);

        let str = `
class Workspace {
    m() {
        return (${text});
    }
}`.trim();

        elem.addCode(str);
        let result = elem.call("Workspace", "m");
        if (result !== undefined) {
            elem.load([{text: text + "\n" + result}]);
        }
    }

    startScripting(info) {
        let { frameInfo, objectInfo } = info;
        let frame = this.getElement(frameInfo);
        if (!frame) {return;}
        let obj = this.getElement(objectInfo);

        let w = parseInt(obj.style.getPropertyValue("width"), 10);

        let t = frame.getTransform().slice();
        let textFrame = this.newNativeText({x: t[4] + w + 10, y: t[5], width: 400, height: 300});
        let text = textFrame.querySelector("#text");

        let scriptors = {...this._get("scriptors")};
        scriptors[text.asElementRef().asKey()] = {
            textFrameRef: textFrame.asElementRef(),
            frameRef: frame.asElementRef(),
            objectRef: obj.asElementRef()
        };
        this._set("scriptors", scriptors);
        let codeArray = obj.getCode();
        let code = codeArray[0] || "";
        if (code.length > 0 && !code.trim().startsWith("class")) {
            code = this.getLibrary(code);
        }
        text.load(code || "");
        this.subscribe(text.id, "text", "PasteUpModel.codeAccepted");
    }

    newNativeText(info) {
        let {x, y, width, height} = info;
        let text = this.createElement("TextElement");
        text.domId = "text";

        text.style.setProperty("-cards-direct-manipulation", true);
        text.style.setProperty("-cards-text-margin", "4px 4px 4px 4px");
        text.setDefault("Poppins", 16);
        text.setWidth(width);

        text.style.setProperty("width", width + "px");
        text.style.setProperty("height", height + "px");
        text.style.setProperty("background-color", "white");

        let t = [1, 0, 0, 1, 0, 0];
        text.setTransform(t);

        let frame = this.createElement();
        frame.setCode("boards.FrameModel");
        frame.setViewCode("boards.FrameView");
        frame.call("FrameModel", "setObject", text, {x, y});

        this.addFrame(frame);
        return frame;
    }

    codeAccepted(data) {
        let {ref, text} = data;
        let info = this._get("scriptors")[ref.asKey()];
        let obj = this.getElement(info.objectRef);
        obj.setCode(text);
    }

    loadDuplicate(data) {
        return this.load(data, "3");
    }

    load(data, version) {
        let SaverClass;
        let myData = data;
        if (version === "3") {
            SaverClass = this.getLibrary("boards.PasteUpSaver3");
            let top = this.wellKnownModel("modelRoot");
            myData = top.parse(data);
        } else {
            console.error("unsupported version");
            // SaverClass = this.getLibrary("boards.PasteUpSaver");
            // myData = version === "2" ? data : JSON.parse(data);
        }

        let {json /*, sessionFavorites, sessionApps */} = myData;
        let saver = new SaverClass();
        let frames = saver.load(json, this);

        if (this._get("initialAppCreated")) {
            this.childNodes.forEach((e) => {
                this.trashObject({target: e.asElementRef()});
            });
        }

        frames.forEach((frame) => {
            this.addFrame(frame);
            let target = this.getElement(frame._get("target"));
            this.comeUpFullyOnReload(frame, target);
        });
        /*
        if (sessionApps) {
            this._set("sessionApps", sessionApps);
            this.publish(this.sessionId, "sessionAppUpdated", null);
        }
        if (sessionFavorites) {
            this._set("sessionFavorites", sessionFavorites);
            this.publish(this.sessionId, "favoritesChanged", null);
        }
        */
        this.publish(this.id, "loadCompleted");
    }

    comeUpFullyOnReload(frame, target) {
        if (target.hasHandler("MiniBrowser")) {
            target.call("MiniBrowser", "comeUpFullyOnReload");
        }
        if (target.hasHandler("Workspace")) {
            this.openWorkspace(null, frame);
        }
    }

    loadPersistentData({ _name, version, data }) {
        try {
            this._delete("loadingPersistentDataErrored");
            this._set("loadingPersistentData", true);
            this.load(data, version);
        } catch (error) {
            console.error("error in loading persistent data", error);
            this._set("loadingPersistentDataErrored", true);
        } finally {
            this._delete("loadingPersistentData");
        }
    }

    savePersistentData() {
        if (this._get("loadingPersistentData")) {return;}
        if (this._get("loadingPersistentDataErrored")) {return;}
        console.log("persist data");
        this._set("lastPersistTime", this.now());
        let top = this.wellKnownModel("modelRoot");
        let func = () => {
            let SaverClass = this.getLibrary("boards.PasteUpSaver3");
            let name = this._get("sessionName") || "Unknown";
            let saver = new SaverClass();
            let sessionFavorites = this._get("sessionFavorites") || {};
            let sessionApps = this._get("sessionApps") || {};
            let json = saver.save(this);
            return {name, version: "3", data: top.stringify({json, sessionFavorites, sessionApps})};
        };
        top.persistSession(func);
    }

    triggerPersist() {
        let lastPersist = this._get("lastPersistTime");
        let persistPeriod = this._get("persistPeriod");
        if (this.now() - lastPersist >= persistPeriod) {
            this._set("persistPending", false);
            this.savePersistentData();
            return;
        }

        if (!this._get("persistPending")) {
            console.log("reschedule persistence call");
            this._set("persistPending", true);
            this.future(this._get("persistPeriod")).call("PasteUpModel", "triggerPersist");
        }
    }

    setBackground(_data) {
    }
}

//  PasteUpView defines behaviour for the #scaler element, along with RemoteCursorView
class PasteUpView {
    init() {
        this.subscribe(this.sessionId, "fileUpload", "handleFileUpload");
        this.subscribe(this.sessionId, "allUserCursorsUpdated", "allUserCursorsUpdated");
        this.subscribe(this.sessionId, "userCursorUpdated", "userCursorUpdated");
        this.subscribe(this.model.id, "userInfoChanged", "userInfoChanged");
        this.subscribe(this.model.id, "trashObject", "trashObject");

        this.subscribe(this.model.id, "loadCompleted", "loadCompleted");

        let iframed = window.parent !== window;
        if (!iframed) {
            this.dom.addEventListener("pointermove", (evt) => this.pointerMove(evt), true);
        }
        this.throttleBaseMS = 20;

        this.setup();

        console.log("PasteUpView.init");
    }

    setup() {
        this.setupUserInfo();
        this.iframes = new Map(); // {contentWindow -> iframe}
        this.iframeInitializers = {}; // url -> { message, data }
        this.viewportRestoreSpec = null; // null or { frameId, scalerRect }
        this.docked = [];
        this.userFavorites = [];
        this.userApps = {};
        this.provisionalApp = null; // for use during drag/drop onto tools

        const { Messenger, App } = Croquet;
        Messenger.setReceiver(this);
        Messenger.setIframeEnumerator(() => this.getIframes());
        Messenger.on("appReady", "handleAppReady");
        Messenger.on("sessionInfoRequest", "handleSessionInfoRequest");
        Messenger.on("userInfoRequest", "handleUserInfoRequest");
        Messenger.on("videoChatInitialStateRequest", "handleVideoChatInitialStateRequest");
        Messenger.on("allUserInfoRequest", "handleAllUserInfoRequest");
        Messenger.on("userCursorRequest", "handleUserCursorRequest");
        Messenger.on("transparencyRequest", "handleTransparencyRequest");
        Messenger.on("creatingUserRequest", "handleCreatingUserRequest");
        Messenger.on("appInfo", "handleAppInfo");
        Messenger.on("walletContents", "handleWalletContents");
        Messenger.on("pointerPosition", "handlePointerPosition");

        App.root = 'middle';

        let beaconView = window.topView.querySelector("#beacon");
        if (beaconView) {
            beaconView.call("BeaconView", "sendBeacon");
            window.topView.detachCallbacks.push(() => {
                beaconView.call("BeaconView", "clearTimeout");
            });
        }

        this.setupAppFileFormats();

        let participants = window.topView.querySelector("#room-participants");
        if (participants) {
            participants.call("RoomParticipantsView", "setScaler", this);
        }

        if (this.model._get("initialAppCreated")) {
            this.app = this.querySelector(`#${this.model._get("initialAppCreated")}`);
        }
    }

    setupUserInfo() {
        let viewId = window.topView.viewId;
        let nickname;
        let initials;
        let sessionName;
        if (window.fromLandingPage) {
            nickname = window.fromLandingPage.nickname;
            initials = window.fromLandingPage.initials;
            sessionName = window.fromLandingPage.sessionName;
        }

        if (!nickname) {
            nickname = viewId;
        }

        if (!initials) {
            let pieces = nickname.split(" ").filter(piece => piece.length > 0);
            if (pieces.length === 1) {
                initials = pieces[0].slice(0, 2).toUpperCase();
            } else {
                initials = pieces.map(piece => piece[0]);
                initials = initials[0] + initials.slice(-1);
                initials = initials.toUpperCase();
            }
        }

        let userId = nickname; // @@ until we have the real database id

        console.log("setupUserInfo", nickname, viewId);
        this.localUserInfoPromise = new Promise(resolve => this.localUserInfoResolver = resolve);
        this.publish(this.model.id, "setUserInfo", {nickname, initials, viewId, userId, sessionName});
    }

    getAllUserInfo() {
        return this.model._get("userInfo") || {};
    }

    getUserInfo(viewId) {
        return this.getAllUserInfo()[viewId] || {};
    }

    getUserInitials(viewId) {
        let info = this.getUserInfo(viewId);
        return info.initials;
    }

    getUserId(viewId) {
        let info = this.getUserInfo(viewId);
        return info.userId;
    }

    getUserColor(viewId) {
        let info = this.getUserInfo(viewId);
        return info.userColor;
    }

    getDragImageDetails() {
        return this.dragImageDetails;
    }

    getUserApps() {
        return this.userApps;
    }

    setupAppFileFormats() {
    }

    async getAppForFile(_file) {
        return null;
    }

    getAllDroppableFileFormats() {
        return Promise.resolve({ types: [], extensions: [] });
    }

    setProvisionalApp(_appName, _spec) {
    }

    clearProvisionalApp(_keep) {
    }

    randomColor(viewId) {
        let h = Math.floor(parseInt(viewId, 36) / (36 ** 10) * 360);
        let s = "40%";
        let l = "40%";
        return `hsl(${h}, ${s}, ${l})`;
    }

    allUserCursorsUpdated() {
        // handle allUserCursorsUpdated event
        let userInfo = this.getAllUserInfo();
        Object.keys(userInfo).forEach(viewId => this.userCursorUpdated(viewId));
    }

    userCursorUpdated(viewId) {
        // handle userCursorUpdated event, or invocation from allUserCursorsUpdated
        this.call("RemoteCursorView", "updatePointer", viewId);
    }

    userInfoChanged() {
        let info = this.getAllUserInfo();
        if (info[this.viewId]) this.localUserInfoResolver();
        this.sendAllUserInfo();
    }

    sendAllUserInfo(sourceOrNull) {
        Croquet.Messenger.send("allUserInfo", this.getAllUserInfo(), sourceOrNull);
    }

    pointerMove(evt) {
        // console.log("PasteUpView.pointerMove", evt);
        if (!this.dom.parentNode) {return;}
        let [x, y] = this.translatePointerPosition(evt.clientX, evt.clientY);
        if (x === null || y === null) {return;}
        let target;
        if (typeof evt.target === "string") {
            target = evt.target;
        } else if (typeof evt.target === "object") {
            target = evt.target.key;
        } else {
            target = this.dom.key;
        }

        this.call("RemoteCursorView", "localMouseMove", { time: evt.timeStamp, target, x, y });
    }

    translatePointerPosition(clientX, clientY) {
        if (this.app && this.app.model._get("_useCustomPointTransformer")) {
            return this.translatePointerPositionByInitialApp(clientX, clientY);
        }

        let x, y;
        let translation = this.currentTranslation || {x: 0, y: 0};
        let zoom = this.currentZoom || 1;
        let rect = this.dom.parentNode.getBoundingClientRect();
        x = clientX - rect.x;
        y = clientY - rect.y;
        x = (x + translation.x) / zoom;
        y = (y + translation.y) / zoom;
        return [x, y];
    }

    translatePointerPositionByInitialApp(clientX, clientY) {
        return this.app.call(...this.app.model._get("_useCustomPointTransformer"), clientX, clientY);
    }

    //invertPointerPositionByInitialApp(clientX, clientY) {
    //return this.app.call(...this.app.model._get("_useCustomPointInverter"), clientX, clientY);
    //}

    drop(evt) {
        const dropPoint = {x: evt.offsetX, y: evt.offsetY};
        const files = [];
        const dt = evt.dataTransfer;
        if (dt.types.includes("Files")) {
            for (let i = 0; i < dt.files.length; i++) {
                const file = dt.files[i];
                // it would be good to filter out folders at this point,
                // but that's easier said than done.
                // a folder will have type of "", as will any file of a
                // type that the browser doesn't recognise.  if the item
                // has an extension that our apps can handle, the item
                // will be processed (even if its type is empty).
                // a folder that appears to have an extension will be
                // processed, but will fail at the reading stage.
                files.push(file);
            }
        }
        if (files.length) this.handleFileUpload(files, dropPoint);
    }

    addAsset(descriptor) {
        this.publish(this.model.id, "addAsset", {
            descriptor,
            currentTranslation: this.currentTranslation,
            currentZoom: this.currentZoom,
            dropPoint: descriptor.dropPoint
        });
    }

    openDialog(pos, label, type, callback, initialValue) {
        // since removal of intermediate file-upload dialog, for now this
        // is expected to be invoked only with type="text".  old code
        // structure is retained in case we come up with other dialog needs.
        let removeDialog = () => {
            if (this.dialog) {
                this.dialog.remove();
                this.dialog = null;
            }
        };

        if (this.dialog) {
            removeDialog();
            return;
        }

        this.dialog = document.createElement("div");
        this.dialog.classList.add("simpleDialog");

        if (type === "text") {
            this.dialog.innerHTML = `<span style="font-family: Poppins">${label}:</span><br><input id="field" type="text" autocomplete="off" style="width:200px; height: 20px"></input><br><button id="accept">Accept</button>&nbsp;<button id="cancel">Cancel</button>`;
        }

        let field = this.dialog.querySelector("#field");

        let cancelCallback = _evt => {
            callback(null);
            removeDialog();
        };
        let acceptCallback;
        let evtCallback;
        if (type === "text") {
            acceptCallback = (_evt) => {
                let value = field.value;
                callback(value);
                removeDialog();
            };
            evtCallback = (evt) => {
                if (evt.key === "Enter" || evt.keyCode === 13 || evt.keyCode === 10) {
                    acceptCallback(evt);
                }
                if (evt.key === "Escape") cancelCallback();
            };

            field.addEventListener("keydown", evtCallback);
        }

        this.dialog.style.setProperty("left", (pos.x + 32) + "px");
        this.dialog.style.setProperty("top", (pos.y + 32) + "px");

        if (type === "text") {
            this.dialog.querySelector("#cancel").addEventListener("click", cancelCallback);
            this.dialog.querySelector("#accept").addEventListener("click", acceptCallback);
        }

        let parent = document.body;
        parent.appendChild(this.dialog);

        if (type === "text") {
            field.focus();
            if (initialValue) field.value = initialValue;
        }
    }

    async handleFileUpload(files, dropPoint = null) {
        const MAX_FILE_MB = 50;
        let currentTranslation = this.currentTranslation;
        let zoom = this.currentZoom;

        const uploads = { pix: [], docview: [] };
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const { size, type } = file;

            if (size > MAX_FILE_MB * 1048576) {
                this.showToastWarning(`${file.name} exceeds max size of ${MAX_FILE_MB}MB`);
                continue;
            }

            // because we're waiting on a single promise, there's
            // no merit in parallelising the lookups.
            // eslint-disable-next-line no-await-in-loop
            let app = await this.getAppForFile(file); // currently assumed to be "pix", "docview", or null
            if (app) uploads[app].push(file);
            else {
                this.showToastWarning(`${file.name} is of unhandled type "${type}"`);
                continue;
            }
        }

        let stagger = { x: 0, y: 0 };
        let makeDisplayPoint = () => {
            let pt;
            if (dropPoint) {
                pt = {x: dropPoint.x + stagger.x, y: dropPoint.y + stagger.y};
                stagger.x += 60;
                stagger.y += 40;
            } else {
                pt = {
                    x: (currentTranslation.x + (Math.random() * 50 - 25) + 200) / zoom,
                    y: (currentTranslation.y + (Math.random() * 50 - 25) + 100) / zoom
                };
            }
            return pt;
        };

        let getSendableSpec = file => {
            let bufP;
            // File.arrayBuffer is sparsely supported
            if (file.arrayBuffer) bufP = file.arrayBuffer(); // Promise
            else {
                bufP = new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsArrayBuffer(file);
                });
            }

            return bufP.then(buf => {
                if (buf.byteLength) {
                    return {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        croquet_contents: buf
                    };
                }
                throw Error("length is zero");
            }).catch(err => {
                this.showToastWarning(`${file.name} - ${err.message}`);
                return null;
            });
        };

        let appDefs = this.model._get("sessionApps");
        let pad = window.topView.querySelector("#pad");
        let makeUrl = app => pad.call("TransformView", "urlFromTemplate", appDefs[app].urlTemplate);

        // // all pix files go into one iframe
        // if (uploads.pix.length) {
        //     let fileSpecs = (await Promise.all(uploads.pix.map(file => getSendableSpec(file)))).filter(Boolean);
        //     if (fileSpecs.length) {
        //         let displayPoint = makeDisplayPoint();
        //         let url = makeUrl("pix");
        //         let iframeArgs = {
        //             x: displayPoint.x,
        //             y: displayPoint.y,
        //             width: 600,
        //             height: 500,
        //             viewId: this.viewId,
        //             type: "pix",
        //             url,
        //             appInfo: appDefs["pix"]
        //         };
        //         this.iframeInitializers[url] = { message: "uploadFiles", data: { files: fileSpecs } };
        //         this.publish(pad.model.id, "newIFrame", iframeArgs);
        //     }
        // }

        // pix files becomes a native image
        if (uploads.pix.length) {
            let load = async (item) => {
                const data = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsArrayBuffer(item);
                });

                const handle = await Croquet.Data.store(this.sessionId, data);

                let displayPoint = makeDisplayPoint();
                let iframeArgs = {
                    displayPoint,
                    width: 600,
                    height: 500,
                    viewId: this.viewId,
                    handle,
                    type: "image",
                };
                this.publish(pad.model.id, "newImage", iframeArgs);
            };

            uploads.pix.forEach(load);
        }

        // each docview gets its own
        if (uploads.docview.length) {
            uploads.docview.forEach(async file => {
                let fileSpec = await getSendableSpec(file);
                if (fileSpec) {
                    let displayPoint = makeDisplayPoint();
                    let url = makeUrl("docview");
                    let iframeArgs = {
                        x: displayPoint.x, y: displayPoint.y,
                        width: 600, height: 500,
                        viewId: this.viewId,
                        type: "docview",
                        url,
                        appInfo: appDefs["docview"]
                    };
                    this.iframeInitializers[url] = { message: "uploadFile", data: { file: fileSpec } };
                    this.publish(pad.model.id, "newIFrame", iframeArgs);
                }
            });
        }
    }

    getIframes() {
        let result = [];
        let add = (e, check) => {
            let iframe = e.querySelector("iframe");
            if (iframe) {
                if (check) {
                    if (result.indexOf(iframe) >= 0) {return;}
                }
                result.push(iframe);
            }
        };
        this.dom.childNodes.forEach(add);
        this.docked.forEach(add);
        return result;
    }

    ensureIframeEntry(source) {
        let iframe = this.iframes.get(source);
        if (!iframe) {
            let iframes = this.getIframes();
            iframe = iframes.find(i => i.contentWindow === source);
            if (!iframe) {return null;}
            this.iframes.set(source, iframe);
        }
        return iframe;
    }

    computeSessionHandles() {
        // derive handles { persistent, ephemeral } from the
        // persistentId and sessionId respectively.
        if (!this.sessionHandlesP) {
            this.sessionHandlesP = new Promise((resolve, reject) => {
                let subtle = window.crypto.subtle;
                if (!subtle) {
                    reject(new Error("crypto.subtle is not available"));
                    return;
                }
                let encoder = new TextEncoder();
                let persistent = this.session.persistentId;
                let ephemeral = this.sessionId;
                let promises = [persistent, ephemeral].map(id => {
                    return subtle.digest("SHA-256", encoder.encode(id)).then((bits) => {
                        let map = Array.prototype.map;
                        let handle = map.call(
                            new Uint8Array(bits),
                            x => ("00" + x.toString(16)).slice(-2)).join("");
                        return handle;
                    });
                });
                Promise.all(promises).then(([pHandle, eHandle]) => resolve({persistent: pHandle, ephemeral: eHandle}));
            });
        }

        return this.sessionHandlesP;
    }

    handleAppReady(url, source) {
        this.ensureIframeEntry(source);
        Croquet.Messenger.send("appInfoRequest", null, source);
        if (url && this.iframeInitializers[url]) {
            let { message, data } = this.iframeInitializers[url];
            Croquet.Messenger.send(message, data, source);
            delete this.iframeInitializers[url];
        }
    }

    handleSessionInfoRequest(data, source) {
        let handles = this.computeSessionHandles(); // { persistent, ephemeral }
        let sessionName = window.fromLandingPage && window.fromLandingPage.boardName;
        if (!sessionName) sessionName = this.getSessionName();  // for old ?q=name sessions
        // feb 2021: now supplying an additional handle based on the
        // current session (because some apps - notably video chat - need
        // to know when the hosting session has been updated to new code).
        // for backwards compatibility this is passed as ephemeralSessionHandle,
        // while sessionHandle still represents the persistent session.
        Promise.all([handles, sessionName]).then(([h, s]) => {
            Croquet.Messenger.send("sessionInfo", {sessionHandle: h.persistent, sessionName: s, ephemeralSessionHandle: h.ephemeral}, source);
        });
    }

    async handleUserInfoRequest(data, source) {
        this.ensureIframeEntry(source);
        await this.localUserInfoPromise;
        let origUserInfo = this.getUserInfo(this.viewId);
        let userInfo = {...origUserInfo, viewId: this.viewId};
        Croquet.Messenger.send("userInfo", userInfo, source);
    }

    handleAllUserInfoRequest(data, source) {
        this.sendAllUserInfo(source);
    }

    handleVideoChatInitialStateRequest(data, source) {
        let fromLandingPage = window.fromLandingPage || {};
        let info = {
            mic: fromLandingPage.mic || "on",
            video: fromLandingPage.video || "on",
            cameraDeviceId: fromLandingPage.cameraDeviceId,
            cameraDeviceLabel: fromLandingPage.cameraDeviceLabel,
            cameraDeviceIndex: fromLandingPage.cameraDeviceIndex,
            micDeviceId: fromLandingPage.micDeviceId,
            micDeviceLabel: fromLandingPage.micDeviceLabel,
            micDeviceIndex: fromLandingPage.micDeviceIndex,
            fromLandingPage: !!window.fromLandingPage,
        };
        Croquet.Messenger.send("videoChatInitialState", info, source);
    }

    handleUserCursorRequest(data, source) {
        this.ensureIframeEntry(source);
        let cursor = this.dom.style.getPropertyValue("cursor");
        Croquet.Messenger.send("userCursor", cursor, source);
    }

    miniBrowserViewForSource(source) {
        let iframe = this.ensureIframeEntry(source);
        let parent = iframe && iframe.parentNode;
        let key = parent && parent.key;
        let view = key && window.views[key];
        if (view && view.hasHandler("MiniBrowserView")) return view;
        return null;
    }

    handleTransparencyRequest(data, source) {
        let view = this.miniBrowserViewForSource(source);
        if (view) view.call("MiniBrowserView", "updateTransparency");
    }

    handleCreatingUserRequest(data, source) {
        let view = this.miniBrowserViewForSource(source);
        if (view) view.call("MiniBrowserView", "sendCreatingUser");
    }

    handleAppInfo(data, source) {
        let view = this.miniBrowserViewForSource(source);
        //console.log("handleAppInfo", data);
        if (view) view.call("MiniBrowserView", "setAppInfo", data);
    }

    handleWalletContents(data, source) {
        // since the wallet currently handles only favourites, we
        // assume that this is only invoked when the favourites have
        // changed.
        // the data arg is a deep copy of the wallet contents;
        // take a shallow copy of the favourites dictionary here
        // too, for good measure.

        this.walletIframe = this.ensureIframeEntry(source);
        let {favorites} = data; // spec by url
        this.userFavorites = {...favorites};

        // when a user joins a session, userApps is populated
        // based on the apps for which this user has at least
        // one favourite.
        // note that this process is only additive: the
        // removal of the last favourite from an app does
        // not cause the app to be removed (since the user
        // may still want to create new instances of that app).
        // a user who wants to remove an app must do so explicitly.
        let userApps = this.userApps;
        let appsChanged = false;
        Object.values(favorites).forEach(spec => {
            let { appInfo } = spec;
            let { appName } = appInfo;
            if (!userApps[appName]) {
                let { label, iconName, urlTemplate } = appInfo;
                userApps[appName] = { label, iconName, urlTemplate };
                appsChanged = true;
            }
            // if the local user was in the middle of a
            // tentative favourite addition for an app
            // that the wallet now says is confirmed as a
            // user app, remove the "provisional" status
            // to prevent the app being removed if the
            // favourite addition is cancelled.
            if (this.provisionalApp === appName) {
                this.provisionalApp = null;
            }
        });
        if (appsChanged) this.publish(this.sessionId, "userAppsChanged");

        this.publish(this.sessionId, "favoritesChanged", null); // subscribed to by TransformView, to update tool state.  null because we don't know which apps are affected.
    }

    handlePointerPosition(position, source) {
        let iframe = this.ensureIframeEntry(source);
        if (!iframe) {return;}
        let zoom = this.currentZoom || 1;
        let rect = iframe.getBoundingClientRect();

        // we multiply zoom here but later divide by zoom in pointerMove,
        // but this is simple enough
        let x = rect.x + (position.x * zoom);
        let y = rect.y + (position.y * zoom);

        let data = {clientX: x, clientY: y, target: this.dom.key, timeStamp: Date.now()};
        // its fields have to match up with the ones that are used in pointerMove()

        this.pointerMove(data);
    }

    trashObject(target) {
        let key = target.asElementRef().asKey();
        let view = window.views[key];
        if (!view) {return;}
        let iframe = view.dom.querySelector("iframe");
        if (iframe) {
            this.iframes.delete(iframe.contentWindow, iframe);
        }
        // let menuView = view.querySelector("#dots");
        // menuView.call("FrameMenuView", "hideRemoteMenu");
    }

    addToDock(parent) {
        if (this.docked.indexOf(parent) < 0) {
            this.docked.push(parent);
        }
    }

    removeFromDock(parent) {
        let index = this.docked.indexOf(parent);
        if (index >= 0) {
            this.docked.splice(index, 1);
        }
    }

    nameAndSetFavorite(pos, faveType, spec) {
        let callback = faveName => {
            this.clearProvisionalApp(!!faveName); // keep iff a name has been supplied
            if (!faveName) return;

            faveName = faveName.trim();

            if (faveType === "session") {
                spec.sessionFave = true;
                spec.proposedSessionName = faveName;
            } else if (faveType === "user") {
                spec.userFave = true;
                spec.proposedUserName = faveName;
            }
            this.setFavorite(spec);
        };
        let existingSessionFave = this.model._get("sessionFavorites")[spec.url];
        let sessionName = existingSessionFave && existingSessionFave.faveName;
        let existingUserFave = this.userFavorites[spec.url];
        let userName = existingUserFave && existingUserFave.faveName;
        let proposedName = faveType === "session"
            ? sessionName || userName    // ...existing session name gets precedence
            : userName || sessionName;   // ...opposite
        proposedName = proposedName || "";
        this.openDialog(pos, `Name for ${faveType} favorite`, "text", callback, proposedName);
    }

    getAppFavorites(appName) {
        // return an array of objects { url, userName, sessionName }.

        // first get the session favourites held by the model
        let sessionFavesDict = this.model._get("sessionFavorites");
        let faves = [];
        for (let [url, spec] of Object.entries(sessionFavesDict)) {
            if (spec.appInfo.appName === appName) faves.push({ url, sessionName: spec.faveName });
        }
        // then annotate each one that is also a user favorite
        let userFavesCopy = {...this.userFavorites}; // specs keyed by url
        if (Object.keys(userFavesCopy).length) {
            faves.forEach(spec => {
                let { url } = spec;
                let uSpec = userFavesCopy[url];
                if (uSpec) {
                    spec.userName = uSpec.faveName;
                    delete userFavesCopy[url];
                }
            });
            // and add user faves that aren't also session faves
            Object.keys(userFavesCopy).forEach(url => {
                let uSpec = userFavesCopy[url];
                let { appInfo: { appName: uApp }, faveName } = uSpec;
                if (uApp === appName) {
                    faves.push({url, userName: faveName});
                }
            });
        }
        return faves;
    }

    setFavorite(spec) {
        // invoked when user asks to create a new favourite
        // (session- or user-level), or edits a favourite's name, or
        // toggles sessionFave or userFave status.
        // spec properties:
        //   url: the url in question
        //   appInfo: all details needed to create a tool button (appName, label, iconName, urlTemplate)
        //   userFave: if true/false, add or remove user favorite
        //   proposedUserName: needed if userFave is true
        //   sessionFave: if true/false, add or remove session favorite
        //   proposedSessionName: needed if sessionFave is true

        // console.log("setFavorite", spec);
        let { appInfo, url, sessionFave, userFave } = spec;
        if (userFave !== undefined) {
            if (!this.walletIframe) {
                console.warn("favorite set before wallet iframe known");
                return;
            }
            let walletUpdate = { favorites: { url, spec: userFave ? { appInfo, faveName: spec.proposedUserName } : null } };
            Croquet.Messenger.send("updateWalletContents", walletUpdate, this.walletIframe.contentWindow);
        }
        if (sessionFave !== undefined) {
            let faveUpdate = { appInfo, url, status: sessionFave };
            if (sessionFave) faveUpdate.proposedName = spec.proposedSessionName;
            this.publish(this.model.id, "setSessionFavorite", faveUpdate);
        }
    }

    save(name, asTemplate) {
        let SaverClass = this.model.getLibrary("boards.PasteUpSaver3");
        let saver = new SaverClass();
        let sessionFavorites = this.model._get("sessionFavorites") || {};
        let sessionApps = this.model._get("sessionApps") || {};
        let json = saver.save(this.model, null, asTemplate);
        let top = this.wellKnownModel("modelRoot");

        return this.uploadContents({name, version: "3", data: top.stringify({json, sessionFavorites, sessionApps})});
    }

    getSessionName() {
        let name = this.model._get("sessionName");
        return name ? Promise.resolve(name) : Croquet.App.autoSession("q");
    }

    saveRequest(pos, askName) {
        this.getSessionName().then((proposedName) => {
            if (!askName) {
                this.save(proposedName);
                return;
            }

            let callback = (sessionName) => {
                if (!sessionName) return;
                sessionName = sessionName.trim();
                this.save(sessionName);
            };
            this.openDialog(pos, `New Session Name: `, "text", callback, proposedName);
        });
    }

    loadRequest(pos, askName) {
        this.getSessionName().then((name) => {
            if (!askName) {
                this.loadContents(name);
                return;
            }

            let callback = (loadName) => {
                if (!loadName) return;
                loadName = loadName.trim();
                this.loadContents(loadName);
            };
            this.openDialog(pos, `Load Session Named: `, "text", callback, name);
        });
    }

    uploadContents(data) {
        return Croquet.Data.store(this.sessionId, data.data).then((handle) => {
            return {action: "duplicate", name: data.name, id: Croquet.Data.toId(handle)};
        });
    }

    duplicateAndUpload(newId) {
        return this.save(newId, true).then((dataInfo) => {
            let {action, name, id} = dataInfo;
            console.log(action, name, id);
            let location = window.location;
            let newLocation = `${location.origin}${location.pathname}?r=${newId}&launch=${newId}&dataId=${encodeURIComponent(id)}`;
            window.location.assign(newLocation);
        });
    }

    loadContents(newId, dataId) {
        let handle = Croquet.Data.fromId(dataId);
        return Croquet.Data.fetch(this.sessionId, handle).then((data) => {
            let decoder = new TextDecoder();
            let json = decoder.decode(data);
            this.publish(this.model.id, "loadContents", json);
        });
    }

    loadCompleted() {
        if (this.loadResolve) {
            let resolve = this.loadResolve;
            delete this.loadPromise;
            delete this.loadResolve;
            delete this.loadReject;
            resolve(true);
        }
    }

    resizeDefaultApp(width, height) {
        let defaultApp = this.dom.childNodes[0];
        if (!defaultApp) {return;}
        let pad = defaultApp.querySelector("#pad");
        if (!pad) {return;}

        let app = pad.childNodes[0];
        if (!app) {return;}

        app.style.setProperty("width", `${width}px`);
        app.style.setProperty("height", `${height}px`);

        let appView = window.views[app.key];
        if (appView && appView.model._get("_useCustomResizer")) {
            appView.call(...appView.model._get("_useCustomResizer"));
        }
    }

    showToast(msg, level, duration) { Croquet.App.showMessage(msg, { q_custom: true, position: 'center', level, duration }); }
    showToastLog(msg) { this.showToast(msg); }
    showToastWarning(msg) { this.showToast(msg, "warning", 3000); }
    showToastError(msg) { this.showToast(msg, "error", 3000); }
}


// RemoteCursorView defines behaviour for the #scaler element, along with PasteUpView
class RemoteCursorView {
    init() {
        if (this.pointers) {
            for (let k in this.pointers) {
                this.deletePointer(k);
            }
        }

        if (!this.assetLib) {
            let Cls = this.model.getLibrary("boards.AssetLibrary");
            this.assetLib = new Cls();
        }

        this.pointers = {};
        this.lastPointer = { time: 0, target: null, x: 0, y: 0, viewId: this.viewId };
        // plug this object/trait into the topView as the means of handling
        // pointer changes.  only provide the functions that are allowed to
        // be called from other objects.
        window.topView.pointerTracker = {
            target: this,
            trait: "RemoteCursorView",
            pointerMoved: "pointerMoved",
            deletePointer: "deletePointer",
            deleteAllPointers: "deleteAllPointers",

            // probably not needed
            // setPointer: "setPointer",
            // publishPointer: "publishPointer"
        };

        let iframed = window.parent !== window;
        if (!iframed) {
            this.setPointer();
        }
        console.log("RemoteCursorView.init");
    }

    setPointer() {
        // set the image to be used by the hardware cursor when over this element
        let pointer = this.ensurePointer(this.viewId);
        this.dom.style.setProperty("cursor", `${pointer.style.getPropertyValue("background-image")},auto`);
        pointer.remove();
    }

    localMouseMove(info) {
        let {target, time, x, y} = info;

        if (this.lastPointer.x !== x || this.lastPointer.y !== y) {
            this.lastPointer.target = target;
            this.lastPointer.x = x | 0;
            this.lastPointer.y = y | 0;
            this.lastPointer.time = time | 0;

            window.topView.throttledInvoke("publishPointer", this.throttleBaseMS, () => this.publishPointer({ target: this.lastPointer.target, x: this.lastPointer.x, y: this.lastPointer.y, time: this.lastPointer.time, viewId: this.viewId }));
        }
    }

    deleteAllPointers() {
        for (let k in this.pointers) {
            this.pointers[k].remove();
            delete this.pointers[k];
        }
    }

    deletePointer(viewId) {
        let pointer = this.pointers[viewId];
        if (pointer) {
            pointer.remove();
            delete this.pointers[viewId];
        }
    }

    pointerMoved(obj) {
        // place the cursor for the specified view.
        // we assume no rotation.
        let {target, x, y, viewId} = obj;
        if (viewId === this.viewId) {return;}
        if (!target) {return;}

        let pointer = this.ensurePointer(viewId);

        // the view that a pointer was last recorded as having been
        // over might no longer exist.
        let view = window.views[target];
        if (view && view.model._get("_parent")) {
            view = view.parentNode;
            x -= view.dom.scrollLeft;
            y -= view.dom.scrollTop;
            // should be used only for canvas, where you cannot append another element
        }

        if (this.app && this.app.model._get("_useCustomPointInverter")) {
            let [newX, newY] = this.app.call(...this.app.model._get("_useCustomPointInverter"), x, y);
            x = newX;
            y = newY;
        }

        let zoom = this.currentZoom;
        let currentTranslation = this.currentTranslation;
        if (!zoom || !currentTranslation) {return;}
        let tmpX = (x * zoom) - currentTranslation.x;
        let tmpY = (y * zoom) - currentTranslation.y;

        pointer.style.setProperty("transform", `translate(${tmpX}px,${tmpY}px)`);
    }

    ensurePointer(viewId) {
        let name = this.call("PasteUpView", "getUserInitials", viewId);
        if (!this.pointers[viewId]) {
            let pointer = document.createElement('div');
            pointer.setAttribute("cursor-name", name); // ael - not used?
            pointer.style.setProperty("position", "absolute");
            pointer.style.setProperty("background-repeat", "no-repeat");
            pointer.style.setProperty("background-size", "contain");
            pointer.style.setProperty("width", "32px");
            pointer.style.setProperty("height", "32px");
            pointer.style.setProperty('user-select', 'none');
            pointer.style.setProperty('pointer-events', 'none');
            pointer.style.setProperty("left", "0px");
            pointer.style.setProperty("top", "0px");
            this.pointers[viewId] = pointer;
            this.updatePointerShape(viewId);
            window.topView.dom.appendChild(pointer);
        }
        return this.pointers[viewId];
    }

    updatePointer(viewId) {
        // invoked only from pasteUpView.userCursorUpdated (a behaviour on this
        // same object), which handles the arrival of the name details for a
        // client, or a change in the client's status (e.g., due to start of
        // a presentation).
        // it assumes that the styled pointer div (created by ensurePointer)
        // already exists.
        let pointer = this.pointers[viewId];
        if (!pointer) return;

        this.updatePointerShape(viewId);

        if (viewId === this.viewId) {
            this.dom.style.setProperty("cursor", `${pointer.style.getPropertyValue("background-image")},auto`);
        }
    }

    updatePointerShape(viewId) {
        let pointer = this.pointers[viewId];

        let size = Object.keys(this.pointers).length;

        let viewDetails = window.topView.pluggableDispatch("viewportTracker", "getViewDetails", viewId);
        if (!viewDetails) return; // during initialisation

        let { isLocal, isPresenter, isFollower, isActive } = viewDetails;
        let userInfo = this.call("PasteUpView", "getUserInfo", viewId);
        let userColor = userInfo ? userInfo.userColor : "darkblue";
        let outlineColor = userColor;
        // dec 2020: don't change cursors for presentation
        let fillColor = isLocal ? userColor : (isPresenter ? "white" : "white");
        let initials = this.call("PasteUpView", "getUserInitials", viewId);
        let initialsColor = isLocal
            ? (isPresenter ? "white" : "white")
            : (isPresenter ? userColor : userColor);
        let opacity;
        if (isLocal || isPresenter || (isActive && !isFollower)) {
            opacity = "1";
        } else {
            opacity = (size < 10) ? "0.3" : "0.1";
        }

        // console.log({ viewId, initials, isLocal, isPresenter, isFollower, isActive });

        let svg = this.assetLib.avatar(initials, outlineColor, fillColor, initialsColor);
        svg = encodeURIComponent(svg);
        svg = `url('data:image/svg+xml;utf8,${svg}')`;
        pointer.style.setProperty("background-image", svg);

        pointer.style.setProperty("opacity", opacity);
    }

    publishPointer(info) {
        this.publish(this.model.sessionId, "viewPointerMoved", info);
    }
}

class BeaconView {
    init() {
        this.lastTime = Date.now();
        this.timeout = null;
    }

    clearTimeout() {
        console.log("beacon: clear timeout", this.timeout);
        if (this.timeout) {
            clearInterval(this.timeout);
            this.timeout = null;
        }
    }

    sendBeacon() {
        if (!window.fromLandingPage) {return;}
        if (!window.fromLandingPage.sessionName) {return;}
        if (!window.Database) {return;}

        /*let radar = window.topView.querySelector("#radar");
        radar.call("RadarView", "render", true);
        let canvas = radar.dom.querySelector("#canvas");
        let dataUrl = canvas.toDataURL();
        */
        let sessionName = window.fromLandingPage.sessionName;
        let boardId = sessionName;
        let sessionId = this.sessionId;
        let guestName = window.fromLandingPage.nickname || "guest";
        let data = {thumbnail: null, boardId, sessionId, viewId: this.viewId, guestName};
        window.Database.postLastUpdated(data);
    }

    schedule() {
        this.clearTimeout();
        this.timeout = setInterval(() => this.sendBeacon(), 30000);
        console.log("schedule beacon", this.timeout);
        this.sendBeacon();
    }
}

function start(parent, _json, persistentData) {
    const BOARD_WIDTH = 20000;
    const BOARD_HEIGHT = 20000;

    // let frameQRIcon = parent.getLibrary("minibrowser.QRIcon").iconString();
    // parent.getLibrary("minibrowser.QRIcon").defaultIcon();
    // parent.getLibrary("minibrowser.QRIcon").defaultDragIcon(32, 32);

    parent.setStyleClasses(`

* {
    touch-action: none;
}

body, .no-select {
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
}

.transform-pad {
    position: absolute;
    width: 100%;
    height: 100%;
    overflow: hidden;
}

.transform-scaler {
    background-repeat: repeat;
    /* scaler.style.setProperty("background-image", 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAYElEQVR4XuXTsQnAMAxFQe8/oQotoV7gIE+Q0skVD355ILS6e/fFrfaBPtAH+kAf6AN9oA/0gT7QB/rA91XVzszT7OuAA4uI02wf+LsT+1/sA32gD/SBPtAH+kAf+CngA3LpqvUNyCPlAAAAAElFTkSuQmCC")');*/
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANEAAADRCAYAAABSOlfvAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAmpJREFUeNrs3bFthEAQQFGwXIA78JVACetK3AoduIarhCvBJZBsfh3gWYnAe9iOHIzQe9KIdDXw0V3EMCRSa11iysDjXjZbOOxkbpPhLE9uB4gIRAQiAhEBIgIRgYhARICIQEQgIhARICIQEYgIRASICEQEIgIRASICEYGIQESAiEBEICIQESAiEBGICEQEiAj+1dg+8ZjoPFPMGnN3azol5mYNnct+XTNEVBIt5iPmGvPpGem0F92bNXTe9+vVKr7x4eNf9+LDx8ed+PAxnIWIQEQgIhARiAgQEYgIRAQiAkQEIgIRgYgAEYGIQEQgIkBEICIQEYgIEBGICEQEIgJEBCICEYGIABGBiEBEICJARCAiEBGICBARiAhEBCICRAQiAhGBiEBEgIhARCAiEBEgIhARiAhEBIgIRAQiAhEBIgIRgYhARICIQEQgIhAR8Lex1rpZA5xEBL3EFJs47MWL7riTuY2fc+A/ESAiEBGICEQEIgJEBCICEYGIABGBiEBEICJARCAiEBGICBARiAhEBCICRAQiAhGBiAARgYhARCAiQEQgIhARiAgQEYgIRAQiAkQEIgIRgYgAEYGIQEQgIhARICIQEYgIRASICEQEIgIRASICEYGIQESAiEBEICIQESAiEBGICE7vudZaEp3nJWaKM7kzD5Ldpwxes+xljEMsiRYzxawxd89Ipz0oN2voXPbrahX923bxxv1xL5stHHYyt/GfCE5ARCAiEBGICEQEiAhEBCICEQEiAhGBiEBEgIhARCAiEBEgIhARiAhEBIgIRAQiAhEBIgIRgYhARICIQESQ0JcAAwDLXWiRCFyTrQAAAABJRU5ErkJggg==');
    /* 'url(./assets/bitmaps/grid-pattern-bg.png)'; */
    background-color: #f7f7f7;
    transform-origin: 0px 0px;
}

.beacon {
    width: 1px;
    height: 1px;
}

.room-name-readout {
    padding: 8px 20px 8px 20px;
    font-family: Poppins;
    white-space: nowrap;
}

.room-participants-holder {
    display: flex;
    width: 40px;
    height: 25px;
    border-left: 1px solid #A6A8A9;
    margin-right: 8px;
    padding-left: 16px;
}

.room-participants-icon {
    width: 25px;
    height: 25px;
}

.room-participants-number {
    font-family: Poppins;
    height: 25px;
}

.room-participants-tooltip {
    position: absolute;
    top: 44px;
    max-width: 200px;
    color: #fff;
    background-color: #000;
    border-radius: .25rem;
    font-family: Poppins;
    font-size: 12px;
    display: none;
}

.room-participants-holder:hover .room-participants-tooltip {
    display: block;
}

.room-participants-tooltip-arrow {
    left: 5px;
    top: -0.4rem;
    border-width: 0 .4rem .4rem;
    border-bottom-color: #000;
    border-style: solid;
    color: transparent;
    position: relative;
    width: 1px;
}

.room-participants-tooltip-contents {
    width: fit-content;
    white-space: nowrap;
    padding: 0rem 0.5rem 0.25rem 0.5rem;
}

.room-participants-icon {
    width: 24px;
    height: 24px;
    background-image: url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3Csvg version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 25 25' style='enable-background:new 0 0 25 25;' xml:space='preserve'%3E%3Cstyle type='text/css'%3E .st35%7Bfill:%234D4D4D;%7D%0A%3C/style%3E%3Cg id='Layer_1' class='st0'%3E%3C/g%3E%3Cg id='Layer_2'%3E%3Cg%3E%3Cpath class='st35' d='M4.57,19.5c0.25-3.13,1.68-5.46,4.37-7.01c2.71,1.72,4.58,1.72,7.11-0.01c2.7,1.54,4.13,3.88,4.39,7.01 C15.13,19.5,9.88,19.5,4.57,19.5z'/%3E%3Cpath class='st35' d='M17.1,8.36c-0.03,2.57-2.08,4.57-4.66,4.54c-2.55-0.02-4.58-2.1-4.55-4.66c0.03-2.6,2.1-4.61,4.69-4.57 C15.14,3.71,17.13,5.77,17.1,8.36z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A");
}

#header {
    display: flex;
    align-items: center;
    position: absolute;
    top: 4px;
    left: calc(100% / 2 - 100px);
    z-index: 1000020;

    border-radius: 20px;
    background-color: #f4f9ff;
    height: 40px;
    transition: right 0.25s;
    pointer-events: auto;
}

#middle {
    overflow: hidden;
    width: 100%;
    height: 100%;
    background-color: white;
}`);

    parent.addStyleClasses(`
#peers {
    display: none;
}

#infoBar {
    display: none;
}

.frame-title {
    height: 0px;
    padding: 0px;
    border: 0px;
}

.frame-frame {
    position: absolute;
    height: 100%;
}
`);

    let middle = parent.createElement();
    middle.domId = "middle";

    let pad = parent.createElement();
    pad.domId = "pad";
    pad.classList.add("transform-pad");

    pad.style.setProperty("left", "0px");
    pad.style.setProperty("top", "0px");

    let peers = parent.createElement();
    peers.domId = "peers";

    let scaler = parent.createElement();
    scaler.domId = "scaler";
    scaler.classList.add("transform-scaler");
    scaler._set("boardWidth", BOARD_WIDTH);
    scaler._set("boardHeight", BOARD_HEIGHT);
    scaler.style.setProperty("-cards-direct-manipulation", true);
    scaler.style.setProperty("-cards-transform-origin", "0 0");
    scaler.setTransform([1, 0, 0, 1, 0, 0]);
    // scaler.style.setProperty("width", BOARD_WIDTH + "px");
    // scaler.style.setProperty("height", BOARD_HEIGHT + "px");
    scaler.style.setProperty("width", "100%");
    scaler.style.setProperty("height", "100%");
    scaler.setViewCode(["boards.PasteUpView", "boards.RemoteCursorView"]);
    scaler.setCode("boards.PasteUpModel");

    let tools = parent.createElement();
    tools.domId = "tools";

    // initialise the tools view once it has its children

    pad.appendChild(scaler);

    pad.setViewCode(["boards.TransformView"]);
    pad.setCode("boards.TransformModel");

    middle.appendChild(pad);

    let infoBar = parent.createElement();
    infoBar.domId = "infoBar";

    let beacon = parent.createElement();
    beacon.domId = "beacon";
    beacon.classList.add("beacon");
    beacon.setViewCode("boards.BeaconView");

    let header = parent.createElement();
    header.domId = "header";
    header.classList.add("flap");

    let roomName = parent.createElement();
    roomName.domId = "roomName";
    roomName.setCode("boards.RoomNameModel");
    roomName.setViewCode("boards.RoomNameView");

    let roomParticipants = parent.createElement();
    roomParticipants.domId = "room-participants";
    roomParticipants.setCode("boards.RoomParticipantsModel");
    roomParticipants.setViewCode("boards.RoomParticipantsView");

    header.appendChild(roomName);
    header.appendChild(roomParticipants);

    infoBar.appendChild(beacon);

    parent.appendChild(peers);
    parent.appendChild(middle);
    parent.appendChild(tools);
    parent.appendChild(header);
    parent.appendChild(infoBar);

    if (persistentData) {
        scaler.call("PasteUpModel", "loadPersistentData", persistentData);
    }
    return parent;
}

class AssetLibrary {
    avatar(initials, outlineColor, fillColor, initialsColor) {
        // this seems to be called more than necessary.
        return `
<svg width="32px" height="32px" viewBox="0 0 32 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- Generator: Sketch 64 (93537) - https://sketch.com -->
    <title>avatar/cursor/small</title>
    <desc>Created with Sketch.</desc>
    <defs>
        <path d="M17,0 L17.0002994,0.0307604489 C25.3708878,0.547104153 32,7.49939602 32,16 C32,24.836556 24.836556,32 16,32 C7.49939602,32 0.547104153,25.3708878 0.0307604489,17.0002994 L0,17 L0,0 L17,0 Z" id="path-1"></path>
        <filter x="-15.6%" y="-12.5%" width="131.2%" height="131.2%" filterUnits="objectBoundingBox" id="filter-2">
            <feOffset dx="0" dy="1" in="SourceAlpha" result="shadowOffsetOuter1"></feOffset>
            <feGaussianBlur stdDeviation="1.5" in="shadowOffsetOuter1" result="shadowBlurOuter1"></feGaussianBlur>
            <feColorMatrix values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.203780594 0" type="matrix" in="shadowBlurOuter1" result="shadowMatrixOuter1"></feColorMatrix>
            <feOffset dx="0" dy="0.5" in="SourceAlpha" result="shadowOffsetOuter2"></feOffset>
            <feGaussianBlur stdDeviation="0.5" in="shadowOffsetOuter2" result="shadowBlurOuter2"></feGaussianBlur>
            <feColorMatrix values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.304223121 0" type="matrix" in="shadowBlurOuter2" result="shadowMatrixOuter2"></feColorMatrix>
            <feMerge>
                <feMergeNode in="shadowMatrixOuter1"></feMergeNode>
                <feMergeNode in="shadowMatrixOuter2"></feMergeNode>
            </feMerge>
        </filter>
    </defs>
    <g id="avatar/cursor/small" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g id="Combined-Shape">
            <use fill="black" fill-opacity="1" filter="url(#filter-2)" xlink:href="#path-1"></use>
            <use fill="${outlineColor}" fill-rule="evenodd" xlink:href="#path-1"></use>
        </g>
        <path d="M17,2 L17.0008661,2.0352252 C24.2657313,2.54839185 30,8.60454082 30,16 C30,23.7319865 23.7319865,30 16,30 C8.94734804,30 3.11271995,24.7850199 2.14189822,18.0008423 L2,18 L2,2 L17,2 Z" id="Combined-Shape" fill="${fillColor}"></path>
        <text id="TD" font-family="Poppins, Poppins, sans-serif" font-size="13" font-weight="500" fill="${initialsColor}">
            <tspan x="7.0" y="20">${initials}</tspan>
        </text>
    </g>
</svg>`;
    }
}

/* eslint-disable import/first */
import {supplemental} from "./shell-supplemental.js";
import {PasteUpSaver3} from "./shell-saver3.js";

export const boards = {
    expanders: [
        TransformModel, TransformView,
        PasteUpModel, PasteUpView,
        RemoteCursorView,
        BeaconView,
        ...Object.keys(supplemental).map(k => supplemental[k]),
    ],
    functions: [start],
    classes: [PasteUpSaver3, AssetLibrary]
};
