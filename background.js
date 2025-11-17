/* Background service worker for Region Screenshot (MV3) */

function formatNowForFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

// Global guards to prevent duplicate selection or multiple result windows
let isSelecting = false;
let resultWindowId = undefined;

async function injectContentScript(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["contentScript.js"]
    });
}

async function startSelectionOnTab(tabId) {
    if (isSelecting) return;
    isSelecting = true;
    try {
        await injectContentScript(tabId);
        await chrome.tabs.sendMessage(tabId, { type: "START_SELECTION" });
    } catch (err) {
        // Tab may not support scripts (e.g., chrome:// pages)
        console.warn("Failed to start selection:", err);
        isSelecting = false;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async() => {
        try {
            if (message && message.type === "START_CAPTURE_FLOW") {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const activeTab = tabs && tabs.length ? tabs[0] : null;
                if (!activeTab || !activeTab.id) {
                    sendResponse({ ok: false, error: "No active tab" });
                    return;
                }
                const url = activeTab.url || "";
                if (
                    url.indexOf("chrome://") === 0 ||
                    url.indexOf("chrome-extension://") === 0 ||
                    url.indexOf("edge://") === 0 ||
                    url.indexOf("about:") === 0 ||
                    url.indexOf("devtools://") === 0 ||
                    url.indexOf("view-source:") === 0 ||
                    url.indexOf("https://chrome.google.com/webstore") === 0
                ) {
                    sendResponse({ ok: false, error: "Restricted URL" });
                    return;
                }
                await startSelectionOnTab(activeTab.id);
                sendResponse({ ok: true });
                return;
            }

            if (message && message.type === "CAPTURE_SCREENSHOT") {
                let windowId;
                if (sender && sender.tab && typeof sender.tab.windowId !== "undefined") {
                    windowId = sender.tab.windowId;
                } else {
                    const currentWindow = await chrome.windows.getCurrent();
                    windowId = currentWindow && typeof currentWindow.id !== "undefined" ? currentWindow.id : undefined;
                }
                const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
                sendResponse({ ok: true, dataUrl });
                return;
            }

            if (message && message.type === "STORE_IMAGE") {
                const dataUrl = message && message.dataUrl;
                if (!dataUrl || typeof dataUrl !== "string") {
                    sendResponse({ ok: false, error: "No dataUrl provided" });
                    return;
                }
                await chrome.storage.local.set({ lastCaptureDataUrl: dataUrl });

                // Force end of selection overlay on the originating tab
                try {
                    const originTabId = sender && sender.tab ? sender.tab.id : undefined;
                    if (originTabId) {
                        await chrome.tabs.sendMessage(originTabId, { type: "END_SELECTION" });
                    }
                } catch (_) {
                    // ignore; overlay will have self-cleaned in most cases
                }

                // Mark selection flow complete
                isSelecting = false;

                try {
                    if (typeof resultWindowId === "number") {
                        // Try to focus existing result window
                        try {
                            await chrome.windows.update(resultWindowId, { focused: true });
                        } catch (e) {
                            // Window likely closed; clear and recreate below
                            resultWindowId = undefined;
                        }
                    }

                    if (typeof resultWindowId !== "number") {
                        const win = await chrome.windows.create({
                            url: chrome.runtime.getURL("popup.html"),
                            type: "popup",
                            width: 420,
                            height: 560
                        });
                        if (win && typeof win.id === "number") {
                            resultWindowId = win.id;
                            const onRemoved = (removedId) => {
                                if (removedId === resultWindowId) {
                                    resultWindowId = undefined;
                                    try { chrome.windows.onRemoved.removeListener(onRemoved); } catch (_) {}
                                }
                            };
                            chrome.windows.onRemoved.addListener(onRemoved);
                        }
                    }
                } catch (__) {
                    // ignore any window errors
                }
                sendResponse({ ok: true });
                return;
            }

            if (message && message.type === "RESTART_SELECTION") {
                const tabId = sender && sender.tab ? sender.tab.id : undefined;
                if (tabId) {
                    await startSelectionOnTab(tabId);
                    sendResponse({ ok: true });
                    return;
                }
            }
        } catch (error) {
            console.error("Error handling message:", error);
            sendResponse({ ok: false, error: (error && error.message) ? error.message : String(error) });
        }
    })();
    return true; // Keep the message channel open for async responses
});