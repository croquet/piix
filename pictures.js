/* globals Croquet Swal */

class PictureModel {
    init() {
        this.subscribe(this.id, "addImage", "addImage");
        this.subscribe(this.id, "removeImage", "removeImage");
        this.subscribe(this.id, "goToImage", "goToImage");
        this.subscribe(this.sessionId, "newBlank", "newBlank");

        this.subscribe(this.id, "setPrepopulated", "setPrepopulated");
        this.subscribe(this.id, "setInitialHTML", "setInitialHTML");

        this.subscribe(this.sessionId, "goToImageNamed", "goToImageNamed");

        if (!this._get("images")) {
            this._set("images", [{key: 0, width: 1024, height: 1024}]);
            this._set("index", 0); // there is already an entry
            this._set("key", 1); // 0 is used as default

            let image = this.createElement("img");
            image.domId = "image";
            image.setViewCode("pix2.ImageLoadNotifier");
            this.appendChild(image);
            image.style.setProperty("display", "none");
            // image._set("src", "https://croquet.io/q/icon.png");

            let imageCover = this.createElement("img");
            imageCover.domId = "imageCover";
            imageCover.style.setProperty("display", "none");
            imageCover.setViewCode("pix2.ImageLoadTester");
            imageCover.style.setProperty("z-index", 1);
            // imageCover._set("src", "https://croquet.io/q/icon.png");
            this.appendChild(imageCover);

            let buttons = ["addButton", "delButton", "prevButton", "nextButton"];
            buttons.forEach(name => {
                let button = this.createElement();
                button.classList.add("picture-button");
                button.domId = name;
                this.appendChild(button);
            });

            let initial = this.createElement();
            initial.domId = "initial";
            this.appendChild(initial);
        }

        console.log("PictureModel.init");
    }

    findIndex(key) {
        let images = this._get("images");
        return images.findIndex(i => i.key === key);
    }

    setInitialImage(data) {
        // let {url, type, width, height, name} = data;
        this._set("initialImage", data);

        let initial = {...data};
        initial.key = 0;

        this._set("images", [initial]);
        this.goToImage({to: initial.key});
    }

    setInitialHTML(html) {
        let initial = this.querySelector("#initial");
        initial.innerHTML = html;
        this.setInitialImage({html, width: 1024, height: 1024});
    }

    setPrepopulated() {
        this._set("prepopulated", true);
    }

    addImage(data) {
        // let {dataId, url, html, type, width, height, name} = data;

        let key = this._get("key");
        data.key = key;
        this._set("key", key + 1);

        let images = [...this._get("images")];
        let index = this._get("index");

        let current = images[index];
        images.splice(index + 1, 0, data);
        this._set("images", images);

        this._set("index", index + 1);
        this.goToImage({from: current && current.key, to: data.key});
    }

    newBlank() {
        // let {dataId, url, html, type, width, height, name} = data;

        let data = {width: 1024, height: 1024};

        let key = this._get("key");
        data.key = key;
        this._set("key", key + 1);

        let images = [...this._get("images")];
        let index = this._get("index");

        let current = images[index];
        images.splice(index + 1, 0, data);
        this._set("images", images);

        this._set("index", index + 1);
        this.goToImage({from: current && current.key, to: data.key});
    }

    goToImage(obj) {
        let images = this._get("images");
        let index = this.findIndex(obj.to);

        if (index < 0) {
            index = images.length > 1 ? images.length - 1 : 0;
        }

        if (images && images.length > index) {
            let image = images[index];
            this._set("index", index);
            this.publish(this.sessionId, "goingToImage", image);
            this.publish(this.sessionId, "triggerPersist");
            let entry = images[index];
            this.showImage(entry);

            let next = this.querySelector("#nextButton");
            let prev = this.querySelector("#prevButton");

            if (next) {
                next.classList.remove("button-hidden");
            }
            if (prev) {
                prev.classList.remove("button-hidden");
            }
            if (images.length <= 2) {
                if (next) {
                    next.classList.add("button-hidden");
                }
                if (prev) {
                    prev.classList.add("button-hidden");
                }
            }

            if (index <= 1) {
                if (prev) {
                    prev.classList.add("button-hidden");
                }
            }

            if (images.length - 1 === index) {
                if (next) {
                    next.classList.add("button-hidden");
                }
            }
        }
    }

    goToImageNamed(name) {
        let target = this._get("images").find((image) => image.name === name);
        if (!target) {return;}
        this.goToImage({to: target.key});
    }

    removeImage(key) {
        if (key === 0) {return;}
        // there should be always at least one
        let images = [...this._get("images")];
        let index = this.findIndex(key);
        if (index > 0) {
            images.splice(index, 1);
            this._set("images", images);
            let newIndex = index === 1 && images.length > 1 ? index : index - 1;
            let prev = images[newIndex];
            this.goToImage({to: prev.key});
            this.publish(this.sessionId, "imageRemoved", key);
        }
    }

    showImage(entry) {
        if (!entry) {return;}
        let img = this.querySelector("#image");
        let {dataId, url, html, type, width, height} = entry;
        let noPicture = !dataId && !url;

        let initial = this.querySelector("#initial");

        if (html) {
            if (this._get("prepopulated")) {return;}
            initial.style.removeProperty("display");
            initial.innerHTML = html;
            if (noPicture) {
                img._set("src", "");
            }
            this.publish(this.id, "askImageLoaded");
            return;
        }

        initial.style.setProperty("display", "none");

        img.style.setProperty("width", `${width}px`);
        img.style.setProperty("height", `${height}px`);
        img.style.setProperty("display", "none");

        if (noPicture) {
            img._set("src", "");
            this.publish(this.id, "askImageLoaded");
        } else if (url) {
            img._set("src", url);
        } else {
            let handle = Croquet.Data.fromId(dataId);
            let current = img._get("src");
            if (typeof current !== "object" || current.handle !== handle) {
                img._set("src", {handle, type});
            }
        }
    }

    loadPersistentData(data) {
        this._set("images", data);
        this._set("index", data && data.length > 0 ? 0 : -1);
    }

    savePersistentData() {
        let top = this.wellKnownModel("modelRoot");
        let func = () => this._get("images");
        top.persistSession(func);
    }
}

class PictureView {
    init() {
        this.subscribe(this.model.id, "askImageLoaded", "askImageLoaded");
        this.subscribe(this.sessionId, "addPicture", "addPictureRequest");
        this.subscribe(this.sessionId, "prevPicture", "prevPicture");
        this.subscribe(this.sessionId, "nextPicture", "nextPicture");
        this.subscribe(this.sessionId, "deletePicture", "deletePicture");

        this.img = this.querySelector("#image");

        this.img.onload = ["ImageLoadNotifier", "imgOnLoad"];
        this.img.onerror = ["ImageLoadNotifier", "imgOnError"];
        this.img.call("ImageLoadNotifier", "setPictureElement", this);

        this.imageCover = this.querySelector("#imageCover");
        this.imageCover.onload = ["ImageLoadTester", "imgOnLoad"];
        this.imageCover.call("ImageLoadTester", "setPictureElement", this);

        this.translation = {x: 0, y: 0};
        this.scale = 1;

        /* scale: decided for each picture for a given window size. A scale factor to make the image fit within the boundary
           translation: in holder's frame to specify the offset of the (0, 0) point of the picture
        */

        window.ondrop = event => {
            event.preventDefault();
            for (const item of event.dataTransfer.items) {
                if (item.kind === "file") this.addFile(item.getAsFile());
            }
        };

        this.isTouch = "ontouchstart" in window;

        this.dom.setAttribute("istouch", `${this.isTouch}`);

        let input = document.createElement("div");
        input.innerHTML = `<input id="imageinput" type="file" accept="image/jpeg,image/gif,image/png,image/bmp" style="display:none;">`;
        this.imageinput = input.firstChild;
        this.dom.appendChild(this.imageinput);

        this.imageinput.onchange = () => {
            for (const file of this.imageinput.files) {
                this.addFile(file);
            }
            this.imageinput.value = "";
        };

        this.wheelHandler = (evt) => this.wheel(evt);

        document.addEventListener("wheel", this.wheelHandler, {passive: false});

        this.querySelector("#nextButton").dom.onclick = () => this.advance(1);
        this.querySelector("#prevButton").dom.onclick = () => this.advance(-1);
        this.querySelector("#addButton").dom.onclick = () => this.imageinput.click();
        this.querySelector("#delButton").dom.onclick = () => this.remove();

        if (!this.isTouch) {
            let timer = 0;
            window.onpointermove = () => {
                if (timer) {
                    clearTimeout(timer);
                } else {
                    this.dom.classList.remove("mouse-inactive");
                }
                timer = setTimeout(() => {
                    this.dom.classList.add("mouse-inactive");
                    timer = 0;
                }, 3000);
            };
            window.onpointermove();
        }

        let shelled = window.glShell;
        if (!shelled) {
            window.onresize = () => {
                this.resizeWindow();
            };
            setTimeout(() => window.onresize(), 0);
        }

        window.pictureView = this;

        this.setupButtons();
        this.addInitialHandler();

        if (window.deferredAddFile) {
            const spec = window.deferredAddFile;
            delete window.deferredAddFile;
            setTimeout(() => this.processAddFile(spec), 0);
        }

        console.log("PictureView.init");
    }

    detach() {
        super.detach();
        if (this.wheelHandler) {
            document.removeEventListener("wheel", this.wheelHandler);
            this.wheelHandler = null;
        }
    }

    setupButtons() {
        let allButtons = ["add", "del", "prev", "next"];
        let buttons = this.model._get("buttons") || allButtons;
        allButtons.forEach((n) => {
            let b = this.querySelector(`#${n}Button`);
            if (b && buttons.indexOf(n) < 0) {
                b.dom.style.setProperty("display", "none");
            }
        });
    }

    resizeWindow() {
        let images = this.model._get("images");
        let entry = images[this.model._get("index")];
        if (entry) {
            this.resizeAndPositionImages(entry.width, entry.height);
            this.publishImageLoaded();
        }
    }

    wheel(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        return true;
    }

    resizeAndPositionImages(width, height) {
        this.resizeImage(width, height);
        this.positionImage();
        this.publishImageLoaded();
    }

    resizeImage(width, height) {
        // should be called only once for image or screen size change.
        let rect = this.dom.parentNode.getBoundingClientRect();
        let scale = Math.min(rect.width / width, rect.height / height);

        this.scale = scale;
        [this.img, this.imageCover].forEach(img => {
            img.dom.style.setProperty("width", `${width}px`);
            img.dom.style.setProperty("height", `${height}px`);
        });
    }

    positionImage() {
        let img = this.img;
        let tx;
        let ty;
        let scale = this.scale;
        let width = parseFloat(img.dom.style.getPropertyValue("width"));
        let height = parseFloat(img.dom.style.getPropertyValue("height"));
        let rect = this.dom.parentNode.getBoundingClientRect();
        tx = (rect.width - scale * width) / 2;
        ty = (rect.height - scale * height) / 2;
        this.translation = {x: tx, y: ty};
        [this.img, this.imageCover].forEach(i => {
            i.dom.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${scale})`);
        });
    }

    askImageLoaded() {
        this.publishImageLoaded();
    }

    publishImageLoaded() {
        let images = this.model._get("images");
        let index = this.model._get("index");
        let {key, width, height} = images[index];
        this.publish(this.sessionId, "imageLoaded", {width, height, translation: this.translation, key: key});
    }

    addInitialHandler() {
        let initial = this.querySelector("#initial");
        if (initial) {
            initial.dom.onclick = () => this.imageinput.click();
        }
    }

    imageLoaded() {
        let images = this.model._get("images");
        let index = this.model._get("index");
        let {width, height} = images[index];
        let imageCover = this.querySelector("#imageCover");
        if (imageCover) {
            imageCover.dom.style.setProperty("display", "none");
        }

        this.img.dom.style.removeProperty("display");

        this.resizeAndPositionImages(width, height);
        this.publishImageLoaded();
    }

    imageErrored(img) {
        this.imageLoaded(img);
        // need to show an error in some way
    }

    loadBolankPage() {
        let {width, height, key} = this.model._get("images")[0];
        this.publish(this.sessionId, "imageLoaded", {width, height, translation: this.translation, key});
    }

    addPictureRequest() {
        this.imageinput.click();
    }

    deletePicture() {
        this.remove();
    }

    async addFile(file) {
        // if the view has disappeared (presumably due to going dormant while an image
        // was being selected), store necessary information to allow the view to load
        // once the session is restored.
        // given browser limitations on lifetime of dragged/selected file objects,
        // we take care to grab the contents while we can.

        const hasView = !!this.dom.parentNode;
        const handleSpec = spec => {
            if (hasView) this.processAddFile(spec);
            else window.deferredAddFile = spec;
            };

        const types = ["image/jpeg", "image/gif", "image/png", "image/bmp"];
        const typeError = !types.includes(file.type);
        if (typeError) {
            handleSpec({ typeError, name: file.name });
            return;
        }

        let data;
        if (file.croquet_contents) data = file.croquet_contents;
        else {
            data = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsArrayBuffer(file);
            });
        }
        const blob = new Blob([data], { type: file.type });
        const { width, height, thumb } = await this.analyzeImage(blob);

        const dataError = !thumb || !width || !height;
        if (dataError) {
            handleSpec({ dataError, name: file.name, isHEIF: this.isHEIF(data) });
            return;
        }

        handleSpec({ type: file.type, name: file.name, width, height, thumb, data });
    }

    async processAddFile(addFileSpec) {
        if (addFileSpec.typeError) {
            const { name } = addFileSpec;
            await Swal.fire({
                title: `${name}: not a supported image format`,
                text: "Please use jpeg, gif, png, or bmp.",
                icon: "error",
                toast: true,
                timer: 10000,
                position: "top-end",
            });
            return;
        }

        if (addFileSpec.dataError) {
            const { name, isHEIF } = addFileSpec;
            await Swal.fire({
                title: `Failed to import ${name}`,
                text: isHEIF ? "HEIF images are not supported by this browser" : `${name} is corrupted or has zero extent`,
                icon: "error",
                toast: true,
                timer: 10000,
                position: "top-end",
            });
            return;
        }

        const { type, name, width, height, thumb, data } = addFileSpec;
        let imageCover = this.querySelector("#imageCover");
        this.resizeAndPositionImages(width, height);
        imageCover.dom.src = thumb; // show placeholder for immediate feedback
        let image = this.querySelector("#image");
        image.dom.style.setProperty("display", "none");
        imageCover.dom.style.removeProperty("display");

        let initial = this.querySelector("#initial");
        if (initial) {
            initial.dom.style.setProperty("display", "none");
        }

        this.publish(this.sessionId, "imageLoadStarted");

        const handle = await Croquet.Data.store(this.sessionId, data);
        const dataId = Croquet.Data.toId(handle);

        this.publish(this.model.id, "addImage", { dataId, type, width, height, name });
    }

    async analyzeImage(blob) {
        const THUMB_SIZE = 32;
        // load image
        const original = new Image();
        original.src = URL.createObjectURL(blob);
        let success = true;
        try {await original.decode();} catch (ex) {success = false;}
        URL.revokeObjectURL(original.src);
        if (!success) return {};

        const { width, height } = original;
        if (!original.width || !original.height) return {};

        // render to thumbnail canvas
        const aspect = original.width / original.height;
        const scale = THUMB_SIZE / Math.max(original.width, original.height);
        const canvas = document.createElement('canvas');
        canvas.width = aspect >= 1 ? THUMB_SIZE : THUMB_SIZE * aspect;
        canvas.height = aspect <= 1 ? THUMB_SIZE : THUMB_SIZE / aspect;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(original, 0, 0);
        // export as data url
        const thumb = canvas.toDataURL("image/png");
        return { width, height, thumb };
    }

    isHEIF(buffer) {
        const FTYP = 0x66747970; // 'ftyp'
        const HEIC = 0x68656963; // 'heic'
        const data = new DataView(buffer);
        return data.getUint32(4) === FTYP && data.getUint32(8) === HEIC;
    }

    prevPicture() {
        this.advance(-1);
    }

    nextPicture() {
        this.advance(1);
    }

    advance(offset) {
        let images = this.model._get("images");
        let index = this.model._get("index");
        let current = images[index];

        if (images.length > 0 && index + offset === 0) {return;}

        let next = images[index + offset];
        if (current && next) {
            this.publish(this.sessionId, "imageLoadStarted");
            this.publish(this.model.id, "goToImage", {from: current.key, to: next.key});
        }
    }

    async remove() {
        let images = this.model._get("images");
        let index = this.model._get("index");
        let current = images[index];
        if (!current) return;
        if (current.key === 0) return;
        const result = await Swal.fire({
            title: 'Delete this image?',
            text: 'You cannot undo this operation',
            imageUrl: current.thumb,
            showCancelButton: true,
            confirmButtonText: 'Yes, delete it!',
            cancelButtonText: 'No, keep it',
        });
        if (result.value) {
            this.publish(this.model.id, "removeImage", current.key);
        }
    }

    prepopulate(images) {
        if (images.length > 0) {
            this.publish(this.model.id, "setInitialHTML", "");
            images.forEach((data) => {
                this.publish(this.model.id, "addImage", data);
            });
            this.publish(this.model.id, "goToImage", {to: 1});
        }
    }
}

class ImageLoadNotifier {
    setPictureElement(elem) {
        this.elem = elem;
    }

    imgOnLoad(_data) {
        if (this.elem) {
            this.elem.call("PictureView", "imageLoaded", this);
        }
    }

    imgOnError(_data) {
        if (this.elem) {
            this.elem.call("PictureView", "imageErrored", this);
        }
    }
}

class ImageLoadTester {
    setPictureElement(elem) {
        this.elem = elem;
    }

    imgOnLoad(_data) {
        // console.log(data);
    }
}

function pictureStart(parent, _json, _persist) {
    let picture = parent.createElement();
    picture.domId = "picture";
    picture.setCode("pix2.PictureModel");
    picture.setViewCode("pix2.PictureView");

    parent.appendChild(picture);
}

export const pictures = {
    expanders: [PictureModel, PictureView, ImageLoadNotifier, ImageLoadTester],
    functions: [pictureStart],
};
