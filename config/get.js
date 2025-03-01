import { DEFAULT_CONFIG } from "./default.js"

export function getConfig(){
    if (localStorage.getItem("config")) {
        return JSON.parse(localStorage.getItem("config"))
    } else {
        return DEFAULT_CONFIG;
    }
}