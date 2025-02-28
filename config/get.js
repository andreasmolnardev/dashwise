import { DEFAULT_CONFIG } from "./default"

export function getConfig(){
    if (localStorage.getItem("config")) {
        return JSON.parse(localStorage.getItem("item"))
    } else {
        return DEFAULT_CONFIG;
    }
}