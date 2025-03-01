import { changeConfig } from "../config/change-config.js";
import { getPageInfo } from "../move-to-backend/link-preview.js";
import { showActiveTab } from "../settings/tab-controls.js";
import { displayTime } from "../widgets/clock.js";

export function init(config) {

    const linkGroupContainer = document.getElementById('link-group-container');
    const addLinkGroupSelect = document.getElementById('linkgroup-select')

    //add link groups
    config.linkGroups.forEach(linkGroup => {
        linkGroupContainer.insertAdjacentHTML('beforeend', /*html*/`
            <div class="link-group item glass" data-id="">${linkGroup.name}</div>
            ` )

        let optionTitle = linkGroup.name

        if (linkGroup.isDefault) {
            optionTitle + " (default)"
        }

        addLinkGroupSelect.insertAdjacentHTML('beforeend', /*html*/`
            <option value="group-${linkGroup.id}">${optionTitle}</option>
            
            ` )
    })


    const linkGridContainer = document.getElementById("link-grid");
    config.links.forEach(link => {
        linkGridContainer.insertAdjacentHTML("afterbegin", /*html*/`
            <a class="link item surface glass" href="${link.url}">
                    <p class="link-title">${link.title}</p>
                    <span class="link-icon center"><img src="${link.iconUrl}" alt=""></span>
            </a>
            `)
    })

    //display time
    setInterval(() => { displayTime(config.localSettings.timeFormat) }, 250);

    const settingsTabsRadio = document.querySelectorAll('.settings-tabs .item input[type="radio"]')

    Array.from(settingsTabsRadio).forEach(tab => {
        tab.addEventListener('change', () => {
            showActiveTab();
        })
    });

    const addLinkPage = document.querySelector(".add-link-page")

    //exit settings
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            const settings = document.querySelector(".settings");

            if (settings.classList.contains("active")) {
                const children = settings.children;

                for (const child of children) {
                    child.style.opacity = "0";
                    child.style.transform = "translateY(10px)";
                }

                settings.style.backdropFilter = "blur(0px)";
                settings.style.opacity = "0";

                setTimeout(() => {
                    settings.classList.remove("active");

                    for (const child of children) {
                        child.style.opacity = "";
                        child.style.transform = "";
                    }
                    settings.style.backdropFilter = "";
                    settings.style.opacity = "";
                }, 800);

            } else if (addLinkPage.classList.contains("active")) {
                setTimeout(() => {
                    addLinkPage.classList.remove("active");

                    /*for (const child of children) {
                        child.style.opacity = "";
                        child.style.transform = "";
                    } */
                    addLinkPage.style.backdropFilter = "";
                    addLinkPage.style.opacity = "";
                }, 800);
            }

        }
    });

    //add link page
    addLinkPage.querySelector(".close").addEventListener('click', () => {
        addLinkPage.classList.remove("active");
    })

    const newLinkUrl = addLinkPage.querySelector("#new-link-url")
    const commonregex = /^(?:(?:https?):\/\/)?(?:[a-zA-Z0-9-]+\.)+(?:(?:com)|(?:ai)|(?:de)|(?:org)|(?:net)|(?:st)|(?:ca)|(?:uk)|(?:fr)|(?:br)|(?:io)|(?:horse)|(?:dev))(?::\d{1,5})?(?:\/\S*)?$/;

    const popularLinksSection = document.getElementById("popular-links")

    Array.from(popularLinksSection.querySelectorAll(".popular-webpages-grid .item")).forEach(item => {
        item.addEventListener('click', () => {

            newLinkUrl.dispatchEvent(new CustomEvent("keyup", {
                detail: {
                    trigger: "popular-link",
                    title: item.querySelector("p.title").textContent,
                    linkUrl: item.dataset.target,
                    imgUrl: item.querySelector("img").src
                }
            }))

        })
    })

    //event for all "popular links" to enter details when clicked on

    const linkDetailLoader = document.querySelector(".add-link-page section.loader");
    const linkDetailSection = document.querySelector(".link-options")

    const linkDetailTitle = linkDetailSection.querySelector(".details #new-link-title")
    const linkIconUrl = linkDetailSection.querySelector(".details #new-link-icon-url")

    const linkAddBtn = document.getElementById("link-add-btn")

    //event gets triggered when manual inputs are taken for the new link's URL bar
    newLinkUrl.addEventListener('keyup', (event) => {
        //add code here

        popularLinksSection.classList.remove("active");

        if (event.detail && event.detail.trigger == "popular-link") {

            linkDetailLoader.classList.remove("active");
            linkDetailSection.classList.add("active");

            newLinkUrl.value = event.detail.linkUrl;
            linkDetailTitle.value = event.detail.title;
            linkIconUrl.value = event.detail.imgUrl;

            linkDetailSection.querySelector(".preview .link-title").textContent = event.detail.title
            linkDetailSection.querySelector(".preview .link-icon img").src = event.detail.imgUrl

            linkDetailSection.dispatchEvent(new Event("input"))

        } else if (commonregex.test(newLinkUrl.value)) {

            linkDetailLoader.classList.remove("active");
            linkDetailSection.classList.add("active");

            getPageInfo("https://" + newLinkUrl.value.replace("https://", "")).then(data => {
                console.log(data)

                //fill out data
                linkDetailTitle.value = data.title;
                linkIconUrl.value = data.icon;

                linkDetailSection.querySelector(".preview .link-title").textContent = data.title
                linkDetailSection.querySelector(".preview .link-icon img").src = data.icon

            })

            linkDetailSection.dispatchEvent(new Event("input"))

        } else if (newLinkUrl.value == "") {
            popularLinksSection.classList.add("active");
            linkDetailLoader.classList.remove("active");
            linkDetailSection.classList.remove("active");

        } else {
            linkDetailLoader.classList.add("active")
        }

        //Add event listeners for when the detail values change so that the preview changes as well

        linkDetailTitle.addEventListener('change', () => {
            console.log("title change")
            linkDetailSection.querySelector(".preview .link-title").textContent = linkDetailTitle.value
        })

        linkIconUrl.addEventListener('change', () => {
            linkDetailSection.querySelector(".preview .link-icon img").src = linkIconUrl.value
        })        
    })

    linkDetailSection.addEventListener('input', () => {
        if (linkIconUrl.value && linkDetailTitle.value && addLinkGroupSelect.value) {
            linkAddBtn.disabled = false;
        }
    }) 

    linkAddBtn.addEventListener('click', () => {
        if (newLinkUrl.value && linkIconUrl.value && linkDetailTitle.value && addLinkGroupSelect.value) {
            changeConfig("links", "add", {
                title:  linkDetailTitle.value ,
                url: newLinkUrl.value,
                iconUrl: linkIconUrl.value,
                linkGroup: addLinkGroupSelect.value.replace("group-", "")
            })

            location.reload();
        } else {
            alert("Could not add the link. Fill out every required field.")
        }
    })


}
