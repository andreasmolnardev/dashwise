import { getPageInfo } from "../move-to-backend/link-preview.js";
import { showActiveTab } from "../settings/tab-controls.js";
import { displayTime } from "../widgets/clock.js";

export function init(config) {
    const linkGridContainer = document.getElementById("link-grid");

    config.links.forEach(link => {
        linkGridContainer.insertAdjacentHTML("afterbegin", /*html*/`
            <a class="link item surface glass" href="${link.url}">
                    <p class="link-title">${link.title}</p>
                    <span class="link-icon center"><img src="${link.iconUrl}" alt=""></span>
            </a>
            `)
    })

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

        } else if (commonregex.test(newLinkUrl.value)) {

            linkDetailLoader.classList.remove("active");
            linkDetailSection.classList.add("active");

            getPageInfo(newLinkUrl.value).then(data => {
                console.log(data)

                //fill out data
                linkDetailTitle.value = data.title;
                linkIconUrl.value = data.image;

                linkDetailSection.querySelector(".preview .link-title").textContent = data.title
                linkDetailSection.querySelector(".preview .link-icon img").src = data.image

            })

        } else if (newLinkUrl.value == "") {
            popularLinksSection.classList.add("active");
            linkDetailLoader.classList.remove("active");
            linkDetailSection.classList.remove("active");

        } else {
            linkDetailLoader.classList.add("active")
        }

        //Add event listeners for when the detail values change so that the preview changes as well

        //check whether the form

    })

}