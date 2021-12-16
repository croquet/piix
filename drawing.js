/**

    DrawingModel keeps the data structure for multiple drawing pages in the `drawings` property. When a page change is requested, the corresponding data in "drawings" is assigned into the instance of DrawingCanvasModel.

   A stroke object looks like following but we use a equivalent plain JS object as it is only data

class Stroke {
    constructor() {
        this.done = true;
        this.segments = [];
    }

    addSegment(segment) {
        this.segments.push(segment);
    }

    undo() {
        this.done = false;
    }

    redo() {
        this.done = true;
    }
}

strokeLists is a Map keyed by the viewId so that undo request from a user can be handled.
globals is an ordered list that stores all strokes since the beginning of the session.

A $-property strokeData is used to cache the persitent data keyed by the key of the picture.

DrawingBackground model and view provides a shell for DrawingCanvas model and view. DrawingCavnvas simply provides the features to draw on a single canvas. DrawingBackground provides the scaling and showing/hiding based on the requirement from outside.

*/

class DrawingModel {
    init() {
        this.subscribe(this.sessionId, "view-exit", "viewExit");
        this.subscribe(this.sessionId, "goingToImage", "goingToImage");
        this.subscribe(this.sessionId, "imageRemoved", "imageRemoved");
        this.subscribe(this.id, "resetStrokeData", "resetStrokeData");

        if (!this._get("drawings")) {
            let drawing = {width: 1024, height: 1024, global: [], strokeLists: new Map(), key: 0};
            this._set("drawings", new Map([[0, drawing]]));

            let background = this.createElement("div");
            background.domId = "background";
            background.setCode("pix2.DrawingBackgroundModel");
            background.setViewCode("pix2.DrawingBackgroundView");
            this.appendChild(background);

            let canvas = this.createElement("canvas");
            canvas.domId = "canvas";
            canvas.setCode("pix2.DrawingCanvasModel");
            canvas.setViewCode("pix2.DrawingCanvasView");
            background.appendChild(canvas);
            canvas.call("DrawingCanvasModel", "setData", drawing);
            canvas._set("parentId", this.id);

            let buttonRow = this.createElement();
            buttonRow.domId = "buttonRow";
            buttonRow.classList.add("buttonRow");
            buttonRow.setCode("pix2.ButtonRowModel");
            buttonRow.setViewCode("pix2.ButtonRowView");
            this.appendChild(buttonRow);
        }

        this.$strokeData = new Map(); // {key<number> -> data<string>}

        let canvas = this.querySelector("#canvas");
        let buttonRow = this.querySelector("#buttonRow");
        buttonRow.call("ButtonRowModel", "setDrawerId", canvas.id);
        console.log("DrawingModel.init");
    }

    viewExit(viewId) {
        let drawings = this._get("drawings");
        for (let drawing of drawings.values()) {
            let map = drawing["strokeList"];
            if (map) {
                delete map[viewId];
            }
        }
    }

    resetStrokeData(key) {
        if (this.$strokeData) {
            this.$strokeData.delete(key);
        }
    }

    goingToImage(data) {
        let {key, width, height, dataId, url, html} = data;
        let drawings = this._get("drawings");
        let drawing = drawings.get(key);

        if (!drawing) {
            drawing = {width, height, global: [], strokeLists: new Map(), key};
            drawings.set(key, drawing);
        }

        let canvas = this.querySelector("#canvas");
        let background = this.querySelector("#background");

        canvas.call("DrawingCanvasModel", "setData", drawing);
        let noPicture = !dataId && !url && !html;
        if (noPicture) {
            canvas.classList.add("no-picture");
            this.style.removeProperty("background-color");
        } else {
            canvas.classList.remove("no-picture");
            this.style.setProperty("background-color", "transparent");
        }
        background.call("DrawingBackgroundModel", "setBackground", noPicture ? "white" : "transparent", width, height);
    }

    imageRemoved(key) {
        this.resetStrokeData(key);
        let drawings = this._get("drawings");
        drawings.delete(key);
    }
}

class DrawingBackgroundModel {
    init() {
        console.log("DrawingBackgroundModel");
    }

    setBackground(color, width, height) {
        this.style.setProperty("background-color", color);
        this.style.setProperty("width", width);
        this.style.setProperty("height", height);
    }
}

class DrawingBackgroundView {
    init() {
        this.subscribe(this.sessionId, "imageLoadStarted", "hideDrawing");
        this.subscribe(this.sessionId, "imageLoaded", "showDrawing");
        this.canvas = this.querySelector("#canvas");
        this.scale = 1;
        this.width = 1024;
        this.height = 1024;
        console.log("DrawingBackgroundView.init");
    }

    hideDrawing() {
        let canvas = this.canvas;
        canvas.dom.style.setProperty("display", "none");
        this.timeout = setTimeout(() => {
            this.timeout = 0;
            canvas.dom.style.removeProperty("display");
        }, 5000);
    }

    showDrawing(data) {
        let {translation, width, height, key} = data;
        let canvas = this.canvas;

        canvas.call("DrawingCanvasView", "enable", key !== 0);

        this.resizeImage(width, height);
        this.setScaleAndTranslation(width, height, translation.x, translation.y);
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = 0;
        }

        canvas.call("DrawingCanvasView", "resizeAndDraw");
        canvas.dom.style.removeProperty("display");
    }

    resizeImage(width, height) {
        let rect = this.dom.parentNode.getBoundingClientRect();
        let scale = Math.min(rect.width / width, rect.height / height);

        this.scale = scale;

        [this.canvas].forEach(img => {
            img.dom.style.setProperty("width", `${width}px`);
            img.dom.style.setProperty("height", `${height}px`);
        });
    }

    setScaleAndTranslation(width, height, tx, ty) {
        this.translation = {x: tx, y: ty};
        this.positionImage(width, height);
    }

    positionImage(width, height) {
        let tx;
        let ty;
        let scale = this.scale;
        let rect = this.dom.parentNode.getBoundingClientRect();
        tx = (rect.width - scale * width) / 2;
        ty = (rect.height - scale * height) / 2;
        this.translation = {x: tx, y: ty};

        this.dom.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${scale})`);
        this.dom.style.setProperty("transform-origin", `0px 0px`);
    }
}

class DrawingCanvasModel {
    init() {
        this.subscribe(this.sessionId, "view-exit", "viewExit");
        this.subscribe(this.id, "startLine", "startLine");
        this.subscribe(this.id, "addLine", "addLine");
        this.subscribe(this.id, "undo", "undo");
        this.subscribe(this.id, "redo", "redo");
        this.subscribe(this.id, "clear", "clear");
        if (!this._get("global")) {
            this._set("global", []);
            this._set("strokeLists", new Map());
            this._set("width", 0);
            this._set("height", 0);
            this._set("key", 0);
        }
        console.log("DrawingCanvasModel.init");
    }

    setData(data) {
        let {global, strokeLists, width, height, key} = data;
        this._set("global", global);
        this._set("strokeLists", strokeLists);
        this._set("width", width);
        this._set("height", height);
        this._set("key", key);
    }

    viewExit(viewId) {
        this._get("strokeLists").delete(viewId);
    }

    startLine(key) {
        this.publish(this._get("parentId"), "resetStrokeData", key);
    }

    addLine(data) {
        let {viewId, x0, y0, x1, y1, color, nib, under, isNew, key} = data;

        if (this._get("key") !== key) {return;} // if a page is turned the stroke should be discarded

        let global = this._get("global");
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);
        if (!strokes) {
            strokes = [];
            strokeLists.set(viewId, strokes);
        }

        let stroke;
        if (isNew) {
            stroke = {done: true, segments: []};
            global.push(stroke);
            strokes.push(stroke);
        } else {
            stroke = strokes[strokes.length - 1];
        }

        let segment = {x0, y0, x1, y1, color, nib, under, viewId};
        stroke.segments.push(segment);
        this.publish(this.id, "drawLine", segment);
    }

    undo(viewId) {
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);

        let findLast = () => {
            if (!strokes) {return -1;}
            for (let i = strokes.length - 1; i >= 0; i--) {
                if (strokes[i].done) {return i;}
            }
            return -1;
        };

        let index = findLast();
        if (index >= 0) {
            strokes[index].done = false;
            this.publish(this.id, "drawAll");
        }
    }

    redo(viewId) {
        let strokeLists = this._get("strokeLists");
        let strokes = strokeLists.get(viewId);

        let find = () => {
            if (!strokes) {return -1;}
            if (strokes.length === 0) {return -1;}
            if (strokes.length === 1) {return strokes[0].done ? -1 : 0;}
            for (let i = strokes.length - 1; i >= 1; i--) {
                if (strokes[i].done) {return -1;}
                if (!strokes[i].done && strokes[i - 1].done) {return i;}
            }
            return 0;
        };

        let index = find();
        if (index >= 0) {
            strokes[index].done = true;
            this.publish(this.id, "drawAll");
        }
    }

    clear(_viewId) {
        this._get("global").length = 0;
        this._get("strokeLists").clear();
        this.publish(this.id, "drawAll");
    }

    loadPersistentData(data) {
        this._set("globals", data);
    }

    savePersistentData() {
        let top = this.wellKnownModel("modelRoot");
        let func = () => {
            let global = this._get("global");
            let newGlobal = global.filter(s => !s.undone);
            return newGlobal;
        };
        top.persistSession(func);
    }
}

class DrawingCanvasView {
    init() {
        this.subscribe(this.model.id, "drawLine", "drawLineAndMove");
        this.subscribe(this.model.id, "drawAll", "drawAll");
        this.subscribe(this.model.id, "resizeAndDraw", "resizeAndDraw");
        this.subscribe(this.model.id, "colorSelected", "colorSelected");
        this.subscribe(this.model.id, "nibSelected", "nibSelected");

        this.color = "black";
        this.nib = 8;
        this.addEventListener("pointerdown", "pointerDown");
        this.resizeAndDraw();

        this.glShell = window.glShell;
        this.iframed = window.parent !== window;

        console.log("DrawingCanvasView.init");
    }

    detach() {
        super.detach();
        this.scalerKey = null;
    }

    resize(width, height) {
        if (this.dom.getAttribute("width") !== `${width}`
            || this.dom.getAttribute("height") !== `${height}`) {
            this.dom.setAttribute("width", width);
            this.dom.setAttribute("height", height);
        }
    }

    resizeAndDraw() {
        let width = this.model._get("width");
        let height = this.model._get("height");
        if (width && height) {
            this.resize(width, height);
        }

        this.drawAll();
    }

    colorSelected(color) {
        this.color = color;
    }

    nibSelected(nib) {
        this.nib = nib;
    }

    clear() {
        let canvas = this.dom;
        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    drawAll() {
        let global = this.model._get("global");
        if (!global) {return;}
        this.clear();
        this.drawStrokes(global);
    }

    drawStrokes(strokes) {
        strokes.forEach((stroke) => {
            if (!stroke.done) {return;}
            stroke.segments.forEach((segment) => {
                this.drawLine(segment);
            });
        });
    }

    drawLineAndMove(segment) {
        this.drawLine(segment);

        let {x1, y1, viewId} = segment;
        if (this.viewId === viewId) {return;}
        if (!this.scalerKey) {
            let scaler = window.topView.querySelector("#scaler");
            if (scaler) {
                this.scaler = scaler;
                this.scalerKey = scaler.model.asElementRef().asKey();
            }
        }
        if (this.glShell && !this.iframed && this.scalerKey) {
            this.scaler.call("RemoteCursorView", "pointerMoved", {target: this.scalerKey, x: x1, y: y1, viewId});
        }
    }

    drawLine(segment) {
        let {x0, y0, x1, y1, color, under, nib} = segment;

        let p0 = this.invertPoint(x0, y0);
        let p1 = this.invertPoint(x1, y1);

        let ctx = this.dom.getContext("2d");

        let rule = "source-over";
        let c = color || "black";
        if (color === "#00000000") {
            rule = "destination-out";
            c = "green";
        }
        if (under) {
            rule = "destinationover";
        }
        ctx.globalCompositeOperation = rule;
        ctx.lineWidth = nib || 8;
        ctx.lineCap = "round";
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    }

    pointerDown(evt) {
        if (evt.buttons !== 1) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}

        evt = this.cookEvent(evt);

        this.addEventListener("pointermove", "pointerMove");
        this.addEventListener("pointerup", "pointerUp");
        this.addEventListener("pointercancel", "pointerUp");
        this.addEventListener("pointerleave", "pointerUp");
        this.addEventListener("lostpointercapture", "pointerLost");

        this.setPointerCapture(evt.pointerId);

        let offsetX = evt.offsetX;
        let offsetY = evt.offsetY;
        let p = this.transformPoint(offsetX, offsetY);
        this.lastPoint = p;
        this.isNew = true;
        this.drawingKey = this.model._get("key");
        this.publish(this.model.id, "startLine", this.drawingKey);
    }

    pointerMove(evt) {
        if (evt.buttons !== 1) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}

        evt = this.cookEvent(evt);

        if (this.lastPoint) {
            let x0 = this.lastPoint.x;
            let y0 = this.lastPoint.y;

            let p = this.transformPoint(evt.offsetX, evt.offsetY);

            let color = this.color;
            let nibScale = this.parentNode ? this.parentNode.scale : 1;
            if (!nibScale) {
                nibScale = 1;
            }
            let nib = this.nib / nibScale;
            this.lastPoint = p;
            let isNew = this.isNew;
            this.isNew = false;
            this.publish(this.model.id, "addLine", {viewId: this.viewId, x0, y0, x1: p.x, y1: p.y, color, nib, isNew, key: this.drawingKey});
        }
    }

    pointerUp(evt) {
        if (!this.lastPoint) {return;}
        if (this.disabled) {return;}
        if (!evt.isPrimary) {return;}
        let p = this.transformPoint(evt.offsetX, evt.offsetY);
        let last = this.lastPoint;
        if (last && last.x === p.x && last.y === p.y) {
            this.pointerMove({buttons: evt.buttons,
                              offsetX: evt.offsetX + 0.01,
                              offsetY: evt.offsetY});
            this.publish(this.sessionId, "triggerPersist");
        }
        this.lastPoint = null;

        this.removeEventListener("pointerup", "pointerUp");
        this.removeEventListener("pointermove", "pointerMove");
        this.removeEventListener("pointercancel", "pointerUp");
        this.removeEventListener("pointerleave", "pointerUp");
        this.removeEventListener("lostpointercapture", "pointerLost");
    }

    pointerLost(evt) {
        this.releaseAllPointerCapture();
        this.pointerUp(evt);
    }

    transformPoint(x, y) {
        return {x, y};
    }

    invertPoint(x, y) {
        return {x, y};
    }

    enable(flag) {
        this.disabled = !flag;
        this.publish(this.model.id, "enable", flag);
    }
}

function drawingStart(parent, _json, _persist) {
    let draw = parent.createElement();
    draw.domId = "draw";
    draw.setCode("pix2.DrawingModel");
    parent.appendChild(draw);
}

import {ButtonRowModel, ButtonRowView} from "./buttonRow.js";

export const drawing = {
    expanders: [DrawingModel, DrawingBackgroundModel, DrawingBackgroundView, DrawingCanvasModel, DrawingCanvasView, ButtonRowModel, ButtonRowView],
    functions: [drawingStart],
};
