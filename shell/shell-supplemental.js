class FrameModel {
    setObject(elem, initPos) {
        this._set("target", elem.asElementRef());
        this.initElementsFor(elem);

        if (initPos) {
            let {x, y} = initPos;
            let t = [1, 0, 0, 1, x, y];
            this.setTransform(t);
        }
    }

    getTitleHeight() {
        return 35; // @@ style dependent; needed for position-setting interactions, including creation
    }

    initElementsFor(elem) {
        if (this.title) {return;}

        let frameType = elem._get("desiredFrameType");
        this._set("frameType", frameType);

        let pad = this.createElement();
        pad.domId = "pad";
        pad.classList.add("frame-pad");
        // to mitigate a presumed browser bug that occurs only
        // on some combination of OS and browser version.
        // (introduced as 0.99 on 21 may 2020 in commit 046234d4,
        // "some experiments to address scroll bar issues";
        // updated feb 2021 to quash distracting see-through
        // effects).
        pad.style.setProperty("opacity", "0.99999999");

        pad.appendChild(elem);
        this.pad = pad;

        this.classList.add("frame-frame");
        this.style.setProperty("-cards-direct-manipulation", true);
        this.setTransform(`1,0,0,1,0,0`);

        if (frameType === "stickyNote") {
            this.classList.add("sticky-note");
            pad.classList.add("sticky-note");
        }

        this.appendChild(pad);

        this._set("showBorder", true);
        this._set("background", null);
        this._set("locked", false);
        this._set("showBorder", true);
        this._set("active", false);
        this._set("frameUser", null);
        this._set("interactionStatus", {});
        this._set("qrState", null); // null: don't care, true: all replicas should show, false: all replicas should hide

    }

    beSolidBackground() {
        /* feb 2021: temporarily removed, as interfering with transparency
        this._set("background", "#222222");
        this.style.setProperty("background-color", "#222222");
        */
    }
}

class FrameView {
}


class RoomNameModel {
    init() {
        this.classList.add("room-name-readout");
        this.innerHTML = "(Unknown)";
    }
}

class RoomNameView {
    setName(name) {
        this.dom.textContent = name;
    }
}

class RoomParticipantsModel {
    init() {
        if (!this._get("init")) {
            this._set("init", true);
            this.classList.add("room-participants-holder");
            let icon = this.createElement();
            icon.classList.add("room-participants-icon");

            // icon.innerHTML = `<svg viewBox="0 0 24 24" class="icon-svg"><use href="#img-numberofoccupants"></use></svg>`;
            let number = this.createElement();
            number.classList.add("room-participants-number");
            number.domId = "participants-number";
            number.innerHTML = "0";

            let tooltip = this.createElement("div");
            tooltip.classList.add("room-participants-tooltip");
            tooltip.domId = "participants-tooltip";

            let tooltipArrow = this.createElement("div");
            tooltipArrow.classList.add("room-participants-tooltip-arrow");

            let tooltipContents = this.createElement("div");
            tooltipContents.classList.add("room-participants-tooltip-contents");
            tooltipContents.domId = "participants-contents";

            tooltip.appendChild(tooltipArrow);
            tooltip.appendChild(tooltipContents);

            this.appendChild(number);
            this.appendChild(icon);
            this.appendChild(tooltip);
        }
    }
}

class RoomParticipantsView {
    init() {
        this.tooltip = this.querySelector("#participants-tooltip");
        this.count = this.querySelector("#participants-number");
        this.contents = this.querySelector("#participants-contents");
    }

    setScaler(view) {
        this.scaler = view;
        this.subscribe(this.scaler.model.id, "userInfoChanged", "updateCount");
    }

    setCount(number) {
        this.count.dom.innerHTML = `${number}`;
        this.dom.setAttribute("number", `${number}`);

        if (number > 0) {
            this.tooltip.dom.style.removeProperty("visibility");
        } else {
            this.tooltip.dom.style.setProperty("visibility", "hidden");
        }
    }

    setNames(names) {
        this.contents.dom.innerHTML = names.join("<br>");
    }

    updateCount() {
        let userInfo = this.scaler && this.scaler.model._get("userInfo") || {};
        let keys = Object.keys(userInfo);
        let count = keys.length;
        let names = keys.map(k => userInfo[k].nickname);
        this.setCount(count);
        this.setNames(names);
    }
}

export const supplemental = {FrameModel, FrameView, RoomNameModel, RoomNameView, RoomParticipantsModel, RoomParticipantsView};
