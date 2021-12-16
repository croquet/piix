/* globals Croquet */

import {makeMain, Library} from "./croquet/croquet-virtual-dom.js";
// some other virtual DOM features can be added
import {boards} from "./shell/s.js";
import {pix2} from "./pix2.js";
import apiKey from "./apiKey.js";

let elements = {};
let userColor = randomColor();
let sessionName = "";

let userInfo = {};
let createdRandomName;

export function load() {
    ["panel", "nickname", "enterButton"].forEach((n) => {
        let element = document.querySelector("#" + n);
        elements[n] = element;
    });

    ["blur", "keyup", "input", "keydown", "paste", "copy", "cut", "mouseup"].forEach((e) => {
        elements.nickname.addEventListener(e, updateNick);
    });

    initHash();
    checkLocalStorage();
    setNick();
    updateNick();

    setResizer();
}

function initHash() {
    Croquet.App.autoSession("q").then((s) => {
        sessionName = s;
    });
}

function checkLocalStorage() {
    if (window.localStorage) {
        try {
            let value = window.localStorage.getItem("userInfo");
            if (!value) {return;}
            value = JSON.parse(value);
            if (value.version !== "2") {return;}
            userInfo = value;
        } catch (e) {
            console.log("error in reading from localStorage");
        }
    }
}

function setNick() {
    let nickname;
    if (userInfo && userInfo.nickname) {
        nickname = userInfo.nickname;
    } else {
        nickname = "";
        createdRandomName = nickname;
    }
    elements.nickname.textContent = nickname;
}

function updateNick(evt) {
    let nickname = elements.nickname;
    if (evt && evt.type === "keyup" && evt.key === "Enter") {
        let text = nickname.textContent;
        text = Array.from(text).filter((c) => c !== "\n" && c !== "\r");
        nickname.textContent = text.join("");

        if (nickname.textContent.length !== 0) {
            join();
            return;
        }
    }

    let enterState = nickname.textContent.length === 0 ? "Inactive" : "Active";

    setState(elements.enterButton, enterState);
}

function resizer() {
    if (window.innerWidth >= 384 && window.innerHeight >= 708) {
        elements.panel.style.removeProperty("transform");
        return;
    }

    let ratio = Math.min(window.innerWidth / 384, window.innerHeight / 708) * 0.9;

    elements.panel.style.setProperty("transform", `scale(${ratio})`);
    elements.panel.style.setProperty("transform-origin", `center`);
}

function setResizer() {
    window.addEventListener("resize", resizer);
    resizer();
}

function setState(button, state) {
    if (state === "Inactive") {
        button.onclick = null;
    } else {
        button.onclick = join;
    }
    button.setAttribute("state", state);
}

function join() {
    ["#landing-svg", "#landing-background", "#landing-style"].forEach(n => {
        let elem = document.querySelector(n);
        if (elem) {
            elem.remove();
        }
    });

    let root = document.querySelector("#croquet-root");
    if (root) {
        root.style.setProperty("display", "inherit");
    }

    let nickname = elements.nickname.textContent;
    let boardName = "PiiX";
    let options = {
        nickname, userColor, boardName, sessionName
    };

    window.fromLandingPage = options;
    doJoin(options);
}

function doJoin(options) {
    let library = new Library();
    library.addLibrary("boards", boards);
    library.addLibrary("pix2", pix2);


    if (createdRandomName !== options.nickname) {
        let store = {version: "2", ...options};
        if (window.localStorage) {
            try {
                window.localStorage.setItem("userInfo", JSON.stringify(store));
            } catch (e) {
                console.log("error in writing to localStorage");
            }
        }
    }

    let cSessionName = "piix-" + options.sessionName;

    makeMain("boards.start", {
        appId: "io.croquet.vdom.wrappedPublicPiix",
        apiKey: apiKey,
        eventRateLimit: 60}, library, cSessionName, null, true)();
}

function randomColor() {
    let h = Math.random() * 360;
    let s = "40%";
    let l = "40%";
    return `hsl(${h}, ${s}, ${l})`;
}
