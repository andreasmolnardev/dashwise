import { getConfig } from "./get.js";

export function changeConfig(path, type, value) {
    let CONFIG_JSON = getConfig();
    let keys = path.split("/");
    let lastKey = keys.pop();
    let target = CONFIG_JSON;
    
    // Traverse the path to reach the desired property
    for (let key of keys) {
        if (!(key in target)) {
            target[key] = {}; // Ensure the path exists
        }
        target = target[key];
    }

    if (type === "add") {
        if (Array.isArray(target[lastKey])) {
            target[lastKey].push(value); // Append to an existing array
        } else if (typeof target[lastKey] === "object" && target[lastKey] !== null) {
            Object.assign(target[lastKey], value); // Merge objects
        } else {
            target[lastKey] = value; // Create new property
        }
    } else if (type === "edit") {
        if (lastKey in target) {
            target[lastKey] = value; // Update the existing value
        }
    } else if (type === "delete") {
        if (lastKey in target) {
            delete target[lastKey]; // Remove the property
        }
    }
    
    window.config = CONFIG_JSON;
    localStorage.setItem("config", JSON.stringify(CONFIG_JSON));
}
