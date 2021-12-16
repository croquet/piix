export class ButtonRowModel {
    init() {
        if (!this.querySelector("#pickerButton")) {
            let pickerContainer = this.createElement("div");
            pickerContainer.domId = "pickerContainer";
            let menuContainer = this.createElement("div");
            menuContainer.domId = "menuContainer";

            let menuHolder = this.createElement("div");
            menuHolder.domId = "menuHolder";

            this.appendChild(pickerContainer);
            this.appendChild(menuContainer);
            this.appendChild(menuHolder);

            [
                "picker", "undo", "redo",
                "clear", "delete", "menu"
            ].forEach((n) => {
                let button = this.createElement("div");
                button.classList.add(`doButton`, `${n}Button`);
                button.domId = `${n}Button`;
                let icon = this.createElement("div");
                icon.classList.add("buttonRowIcon", `${n}Icon`);
                button.appendChild(icon);

                if (n === "picker") {
                    pickerContainer.appendChild(button);
                    icon.classList.remove(`buttonRowIcon`);
                } else if (n === "menu") {
                    menuHolder.appendChild(button);
                    button.classList.remove(`doButton`);
                } else {
                    menuContainer.appendChild(button);
                }
            });
        }
    }

    setDrawerId(id) {
        this._set("drawerId", id);
    }
}

export class ButtonRowView {
    init() {
        [
            ["picker", () => this.togglePicker()],
            ["undo", () => this.publish(this.getScope(), "undo", this.viewId)],
            ["redo", () => this.publish(this.getScope(), "redo", this.viewId)],
            ["clear", () => this.publish(this.getScope(), "clear", this.viewId)],
            ["delete", () => this.publish(this.sessionId, "deletePicture")],
            ["menu", () => this.toggleMenu()],
        ].forEach(([n, handler]) => {
            let button = this.querySelector(`#${n}Button`);
            button.dom.onclick = handler;
        });

        this.menuContainer = this.querySelector("#menuContainer").dom;

        this.makePicker();

        this.subscribe(this.getScope(), "enable", "enable");
        console.log("ButtonRowView.init");
    }

    makePicker() {
        this.picker = document.createElement("div");
        this.picker.id = "colorPicker";
        this.picker.classList.add("colorPicker");

        this.colors = [
            ["#1A1A1A", "Black"],
            ["#FFFFFF", "White"],
            ["#808080", "MedGray"],

            ["#F04A3E", "Red"],
            ["#F09132", "Orange"],
            ["#FFDA29", "Yellow"],

            ["#71D2F0", "SkyBlue"],
            ["#2BA341", "GrassGreen"],
            ["#00000000", "Erase"],

        ];

        this.palette = document.createElement("div");
        this.palette.classList.add("color-palette");
        this.colors.forEach(pair => {
            let e = document.createElement("div");
            e.classList.add("swatch");
            e.id = pair[1];
            e.setAttribute("color", pair[0]);

            if (pair[0] !== "#00000000") {
                e.style.setProperty("background-color", pair[0]);
            }
            e.onclick = (evt) => this.selectColor(evt.target);
            this.palette.appendChild(e);
        });

        this.thickness = [2, 4, 12];

        this.nibs = document.createElement("div");
        this.nibs.classList.add("nibs-palette");
        this.nibs.id = "nibs-palette";
        this.thickness.forEach(n => {
            let e = document.createElement("div");
            e.classList.add("swatch-pen");
            e.setAttribute("nib", n);
            e.style.setProperty("width", `${(n === 4 ? 8 : n)}px`);
            e.style.setProperty("height", `${(n === 4 ? 8 : n)}px`);

            let h = document.createElement("div");
            h.classList.add("swatch", "nib-holder");
            h.appendChild(e);
            h.onclick = (evt) => this.selectNib(evt.currentTarget);
            this.nibs.appendChild(h);
        });

        this.picker.appendChild(this.palette);
        this.picker.appendChild(this.nibs);

        this.dom.appendChild(this.picker);

        this.selectColor(this.palette.childNodes[0]);
        this.selectNib(this.nibs.childNodes[1]);
    }

    selectColor(elem) {
        for (let i = 0; i < this.palette.childNodes.length; i++) {
            let child = this.palette.childNodes[i];
            child.classList.remove("selected");
        }

        elem.classList.add("selected");

        let color = elem.getAttribute("color");

        for (let i = 0; i < this.nibs.childNodes.length; i++) {
            let child = this.nibs.childNodes[i].firstChild;
            if (color !== "#00000000") {
                child.style.setProperty("background-color", color);
            } else {
                child.style.setProperty("background-color", "white");
            }
            child.setAttribute("color", color);
        }

        let picker = this.querySelector("#pickerButton");
        picker.dom.firstChild.style.setProperty("background-color", color);
        this.publish(this.getScope(), "colorSelected", color);
    }

    selectNib(holder) {
        for (let i = 0; i < this.nibs.childNodes.length; i++) {
            let child = this.nibs.childNodes[i].firstChild;
            child.classList.remove("selected");
        }

        holder.firstChild.classList.add("selected");

        let scope = this.getScope();
        this.publish(scope, "nibSelected", holder.firstChild.getAttribute("nib"));
    }

    getScope() {
        return this.model._get("drawerId") || this.sessionId;
    }

    enable(flag) {
        this.showPicker(flag);
        this.showMenu(flag);
    }

    showPicker(flag) {
        if (flag) {
            this.picker.classList.remove("picker-hidden");
        } else {
            this.picker.classList.add("picker-hidden");
        }
    }

    togglePicker() {
        this.picker.classList.toggle("picker-hidden");
    }

    showMenu(flag) {
        if (flag) {
            this.menuContainer.classList.remove("menu-hidden");
        } else {
            this.menuContainer.classList.add("menu-hidden");
        }
    }

    toggleMenu() {
        this.menuContainer.classList.toggle("menu-hidden");
    }
}
