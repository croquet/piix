/* globals Croquet tippy */

import {drawing} from "./drawing.js";
import {pictures} from "./pictures.js";

class PixModel {
    init() {
        if (this._get("handlePersistence") === undefined) {
            this._set("handlePersistence", false);
            this._set("lastPersistTime", 0);
        }
        this.subscribe(this.id, "handlePersistence", "handlePersistence");
        this.$strokeData = new Map(); // {key -> data<string>}

        this.setStyleClasses(`
* {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}`);

        console.log("PixModel.init");
    }

    handlePersistence(flag) {
        this._set("handlePersistence", flag);
        if (flag) {
            this.subscribe(this.sessionId, "triggerPersist", "persistRequest");
            this._set("lastPersistTime", 0);
        }
    }

    loadPersistentData(data) {
        let top = this.wellKnownModel("modelRoot");

        if (data.version === "1") {
            data = data.data;
            let d = this.querySelector("#draw");
            let p = this.querySelector("#picture");

            d._set("drawings", top.parse(data.drawing));

            let images = top.parse(data.pictures.images);
            p._set("images", images);
            p._set("index", data.pictures.index);
            p._set("key", data.pictures.key ? data.pictures.key : images.length);
            p.call("PictureModel", "goToImage", {to: 0});
        } else if (data.version === "2") {
            data = data.data;
            let d = this.querySelector("#draw");
            let p = this.querySelector("#picture");

            let drawings = new Map();
            for (let k in data.drawing) {
                drawings.set(parseFloat(k), top.parse(data.drawing[k]));
            }

            d._set("drawings", drawings);
            let images = top.parse(data.pictures.images);
            p._set("images", images);
            p._set("index", data.pictures.index);
            p._set("key", data.pictures.key ? data.pictures.key : images.length);
            let image = images[data.pictures.index];
            let goto = image && image.key || 0;
            p.call("PictureModel", "goToImage", {to: goto});
        }
    }

    persistRequest() {
        const now = this.now();
        if (now - this._get("lastPersistTime") < 30000) {return;}
        /* console.log("write", now); */
        this._set("lastPersistTime", now);
        this.savePersistentData();
    }

    persistentDataAsArray() {
        return [["pix", this.persistentData()]];
    }

    loadPersistentDataAsArray(loader, data) {
        console.log("data");
        let pixData = data.get("pix");
        (new Function(this.getLibrary("pix2.initializeAsApp")))()(this);
        if (pixData) {
            this.loadPersistentData(pixData);
        }
    }

    persistentData() {
        let top = this.wellKnownModel("modelRoot");
        let d = this.querySelector("#draw");
        let p = this.querySelector("#picture");
        let result = {};
        let drawings = d._get("drawings");
        let strokeData = d.$strokeData;
        if (!strokeData) {
            strokeData = new Map();
            d.$strokeData = strokeData;
        }
        for (let key of drawings.keys()) {
            let entry = strokeData.get(key);
            if (!entry) {
                entry = top.stringify(drawings.get(key));
                strokeData.set(key, entry);
            }
            result[key] = entry;
        }

        return {
            version: "2",
            data: {
                drawing: result,
                pictures: {
                    images: top.stringify(p._get("images")),
                    index: p._get("index"),
                    key: p._get("key")
                }
            }
        };
    }

    savePersistentData() {
        let top = this.wellKnownModel("modelRoot");
        let func = () => {
            return this.persistentData();
        };
        top.persistSession(func);
    }
}

class PixView {
    init() {
        let iframed = window.parent !== window;
        if (iframed) {
            let dock = document.body.querySelector("#croquet_dock");
            if (dock) {
                dock.style.setProperty("display", "inherit");
            }
        }

        if (window.parent !== window) {
            Croquet.Messenger.startPublishingPointerMove();
        }

        let shelled = window.glShell;
        if (!shelled) {
            this.publish(this.model.id, "handlePersistence", true);
        }

        this.picture = this.querySelector("#picture");

        setTimeout(() => {
            let picture = this.picture;
            if (!picture) {return;}
            if (picture.model._get("prepopulated")) {
                // this check in theory is not sufficient but the way this code path is used
                // almost guarantees that there is only one client going to the same session
                // at the start up. If later such a case arises, the addImage message
                // needs to have another field to reject a new image in PictureModel.addImage
                picture.call("PictureView", "prepopulate", []);
                return;
            }

            let prepopulate = document.querySelector("#prepopulate");
            let images = [];
            if (prepopulate) {
                let text = prepopulate.textContent;
                /* eslint-disable-next-line no-eval */
                images = eval(text);
                this.publish(picture.model.id, "setPrepopulated");
                let bottom = this.querySelector("#bottom");
                // bottom.future(1000).call("BottomMenuView", "showQRCode");
                this.future(500).publish(picture.model.id, "setPrepopulated");
            }
            picture.call("PictureView", "prepopulate", images);
        }, 100);

        setTimeout(() => {
            let lastSlash = window.location.pathname.lastIndexOf("/");
            let path = window.location.pathname.slice(0, lastSlash);
            let url = window.location.origin + path + "/" + "landing.html";
            window.top.postMessage({type: "ready", url: window.location.href}, "*");
        }, 100);

        this._messageListener = (msg) => {
            if (msg.data.piixRequest) {
                let name = msg.data.piixRequest.name;
                if (name) {
                    this.publish(this.sessionId, "goToImageNamed", name);
                }
            }
        };

        window.addEventListener("message", this._messageListener);
        window.topView.detachCallbacks.push(() => this.detach());
        
        console.log("PixView.init");
    }

    detach() {
        if (this._messageListener) {
            window.removeEventListener("message", this._messageListener);
        }
        this._messageListener = null;
    }

    resizeWindow() {
        let picture = this.picture;
        if (picture) {
            picture.call("PictureView", "resizeWindow");
        }
    }

    transformPoint(x, y) {
        let view = this.picture;
        let translation = view.translation;
        let scale = view.scale;
        let width = view.img.dom.width;
        let height = view.img.dom.height;

        let tx = (x - translation.x) / scale;
        let ty = (y - translation.y) / scale;

        if (tx < 0 || ty < 0 || tx >= width || ty >= height) {
            tx = null;
            ty = null;
        }
        return [tx, ty];
    }

    invertPoint(x, y) {
        let view = this.picture;
        let translation = view.translation;
        let scale = view.scale;
        return [x * scale + translation.x, y * scale + translation.y];
    }
}

class BottomMenuModel {
    init() {
        let bar = this.querySelector("#bottomBar");
        if (!bar) {
            bar = this.createElement();
            bar.domId = "bottomBar";

            [
                "qrCode", "shareLink", "addFromPix", "openNew", "openCroquet"
            ].forEach((n) => {
                let button = this.createElement("div");
                button.classList.add(`bottom-menu-button`, `${n}Button`);
                button.domId = `${n}Button`;
                let icon = this.createElement("div");
                icon.classList.add("bottom-icon", `${n}Icon`);
                button.appendChild(icon);
                bar.appendChild(button);
            });

            this.appendChild(bar);
        }

        console.log("ButtomMenuModel.init()");
    }
}

class BottomMenuView {
    init() {
        this.listeners = [];
        [
            ["qrCode", "qr code", () => this.toggleQRCode()],
            ["shareLink", "share link", () => this.shareLink()],
            ["addFromPix", "add", () => this.addPicture()],
            ["openNew", "open new", () => this.openNew()],
            ["openCroquet", "croquet.io", () => this.openCroquet()],
        ].forEach(([n, label, handler]) => {
            let button = this.querySelector(`#${n}Button`);
            if (n !== "addFromPix") {
                let labelElem = document.createElement("div");
                labelElem.classList.add("bottom-menu-button-label");
                labelElem.textContent = label;
                button.dom.appendChild(labelElem);
            }
            this.listeners.push([button.dom, handler]);
            button.dom.addEventListener("click", handler);
        });

        this.qr = Croquet.App.makeQRCanvas();
        this.dom.appendChild(this.qr);
        this.qr.classList.add("pixQR");
        this.qrShowing = false;

        window.topView.requestInitialization(this, "BottomMenuView", "setupTippyTooltip");
        window.topView.detachCallbacks.push(() => this.detach());

        this.copy = document.createElement("input");
        this.copy.type = "text";
        this.copy.id = "copy";
        this.dom.appendChild(this.copy);
        console.log("BottomMenuView.init()");
    }

    detach() {
        this.listeners.forEach(([elem, handler]) => elem.removeEventListener("click", handler));
    }

    showQRCode() {
        if (this.qrShowing) {return;}
        this.toggleQRCode();
    }
        
    toggleQRCode() {
        this.qrShowing = !this.qrShowing;
        if (this.qrShowing) {
            this.qr.classList.add("qrShow");
        } else {
            this.qr.classList.remove("qrShow");
        }
    }

    setupTippyTooltip() {
        let view = this.querySelector("#shareLinkButton");
        let elem = view.dom;
        tippy(elem, {
            content: "URL copied to clipboard",
            hideOnClick: false,
            trigger: "click",

            onShow(instance) {
                setTimeout(() => {
                    instance.hide();
                }, 2000);
            }
        });
    }

    getUrl() {
        return window.location.href;
    }

    shareLink() {
        let isiOSDevice = navigator.userAgent.match(/ipad|iphone/i);
        let url = this.getUrl();
        let success = false;

        let clipboardAPI = () => {
            if (navigator.clipboard) {
                return navigator.clipboard.writeText(url).then(() => true, () => false);
            }
            return Promise.resolve(false);
        };

        clipboardAPI().then((result) => {
            if (!result) {
                if (!isiOSDevice) {
                    this.copy.value = url;
                    this.copy.select();
                    this.copy.setSelectionRange(0, 99999);
                    document.execCommand("copy");
                    return;
                }

                let range = document.createRange();
                range.selectNodeContents(this.copy);
                this.copy.textContent = url;

                let selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);

                this.copy.setSelectionRange(0, 100000);
                document.execCommand('copy');
            }
        });
    }

    addPicture() {
        let picture = window.topView.querySelector("#picture");
        picture.call("PictureView", "addPictureRequest");
    }

    openNew() {
        let div = document.createElement("div");
        let lastSlash = window.location.pathname.lastIndexOf("/");
        let path = window.location.pathname.slice(0, lastSlash);
        let url = window.location.origin + path + "/" + "index.html";
        div.innerHTML = `<a id="link" target="_blank" rel="noopener noreferrer" href="${url}"></a>`;
        this.dom.appendChild(div);
        let a = div.querySelector("#link");
        a.click();
        div.remove();
    }

    openCroquet() {
        let div = document.createElement("div");
        div.innerHTML = `<a id="link" target="_blank" rel="noopener noreferrer" href="https://croquet.io"></a>`;
        this.dom.appendChild(div);
        let a = div.querySelector("#link");
        a.click();
        div.remove();
    }
}

function start(pix, _json, persistentData) {
    pix.style.setProperty("background-color", "white");

    let picture = pix.createElement();
    picture.domId = "picture";
    picture.setCode("pix2.PictureModel");
    picture._set("buttons", ["prev", "next"]);
    picture.setViewCode("pix2.PictureView");
    picture.classList.add("absolute");

    let draw = pix.createElement();
    draw.domId = "draw";
    draw.setCode("pix2.DrawingModel");
    draw.classList.add("absolute");

    let bottom = pix.createElement();
    bottom.domId = "bottom";
    bottom.setCode("pix2.BottomMenuModel");
    bottom.setViewCode("pix2.BottomMenuView");
    bottom.classList.add("bottom");

    pix.setCode("pix2.PixModel");
    pix.setViewCode("pix2.PixView");

    pix.appendChild(picture);
    pix.appendChild(draw);
    pix.appendChild(bottom);

    if (persistentData) {
        pix.call("PixModel", "loadPersistentData", persistentData);
        return;
    }

    let initial = `
<div class="initial-dialog-background" style="display: flex">
    <div class="initial-dialog-body">
        <div class="initial-dialog-header-sign"></div>
        <div class="initial-dialog-message"><span>Add a picture&nbsp;</span><div class="initial-dialog-button""><div class="addFromPixIcon"></div></div><span>&nbsp;or&nbsp;</span><span style="font-weight: bold">Drag it here</span><span>.</span></div>
    </div>
</div>
`;

    picture.call("PictureModel", "setInitialHTML", initial);
}

function initializeAsApp(pix) {
    let picture = pix.createElement();
    picture.domId = "picture";
    picture.setCode("pix2.PictureModel");
    picture._set("buttons", ["prev", "next"]);
    picture.setViewCode("pix2.PictureView");
    picture.classList.add("absolute");

    let draw = pix.createElement();
    draw.domId = "draw";
    draw.setCode("pix2.DrawingModel");
    draw.classList.add("absolute");

    let bottom = pix.createElement();
    bottom.domId = "bottom";
    bottom.setCode("pix2.BottomMenuModel");
    bottom.setViewCode("pix2.BottomMenuView");
    bottom.classList.add("bottom");

    pix.setCode("pix2.PixModel");
    pix.setViewCode("pix2.PixView");

    pix.appendChild(picture);
    pix.appendChild(draw);
    pix.appendChild(bottom);

    let initial = `
<div class="initial-dialog-background" style="display: flex">
    <div class="initial-dialog-body">
        <div class="initial-dialog-header-sign"></div>
        <div class="initial-dialog-message"><span>Add a picture&nbsp;</span><div class="initial-dialog-button""><div class="addFromPixIcon"></div></div><span>&nbsp;or&nbsp;</span><span style="font-weight: bold">Drag it here</span><span>.</span></div>
    </div>
</div>
`;

    picture.call("PictureModel", "setInitialHTML", initial);
    return pix;
}

export const pix2 = {
    expanders: [
        PixModel, PixView, BottomMenuModel, BottomMenuView, ...drawing.expanders, ...pictures.expanders
    ],
    functions: [...drawing.functions, ...pictures.functions, start, initializeAsApp]
};
