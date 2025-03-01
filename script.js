
//get config from file

import { getConfig } from "./config/get.js";
import { init } from "./init/init.js";
import { getPageInfo } from "./move-to-backend/link-preview.js";

console.log(getConfig())
init(getConfig());

//toggle page edit mode

const editDashboardCheckbox = document.getElementById("edit-dashboard-checkbox")

editDashboardCheckbox.addEventListener("change", () => {
    Array.from(document.getElementsByClassName("edit-page")).forEach(element => {
        element.classList.toggle("hidden")
    })
})

const toggleSettingsCheckbox = document.getElementById("toggle-settings")

toggleSettingsCheckbox.addEventListener("change", () => {
    Array.from(document.getElementsByClassName("settings")).forEach(element => {
        element.classList.toggle("active")
    })
})


//add new link

const addLinkBtn = document.getElementById("add-link")



addLinkBtn.addEventListener('click', () => { document.querySelector(".add-link-page").classList.toggle("active") })
