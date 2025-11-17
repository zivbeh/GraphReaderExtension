(() => {
    if (window.__regionScreenshotActive) {
        // Prevent duplicate overlays if injected multiple times
        return;
    }
    window.__regionScreenshotActive = true;

    const STATE = {
        isSelecting: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        overlay: null,
        mask: null,
        selection: null,
        info: null,
        prevUserSelect: "",
        cleanupFns: []
    };

    function px(n) {
        return `${Math.round(n)}px`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function createOverlayElements() {
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.zIndex = "2147483647";
        overlay.style.cursor = "crosshair";
        overlay.style.userSelect = "none";
        overlay.style.webkitUserSelect = "none";
        overlay.style.MozUserSelect = "none";

        const mask = document.createElement("div");
        mask.style.position = "absolute";
        mask.style.inset = "0";
        mask.style.background = "rgba(0,0,0,0.25)";

        const selection = document.createElement("div");
        selection.style.position = "absolute";
        selection.style.border = "2px solid #3b82f6";
        selection.style.background = "rgba(59,130,246,0.15)";
        selection.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.06) inset";
        selection.style.display = "none";

        const info = document.createElement("div");
        info.style.position = "absolute";
        info.style.padding = "4px 8px";
        info.style.background = "rgba(0,0,0,0.75)";
        info.style.color = "#fff";
        info.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        info.style.fontSize = "12px";
        info.style.borderRadius = "6px";
        info.style.pointerEvents = "none";
        info.style.display = "none";

        overlay.appendChild(mask);
        overlay.appendChild(selection);
        overlay.appendChild(info);
        document.documentElement.appendChild(overlay);

        STATE.overlay = overlay;
        STATE.mask = mask;
        STATE.selection = selection;
        STATE.info = info;
    }

    function updateSelectionBox() {
        const x1 = STATE.startX;
        const y1 = STATE.startY;
        const x2 = STATE.currentX;
        const y2 = STATE.currentY;
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        STATE.selection.style.left = px(left);
        STATE.selection.style.top = px(top);
        STATE.selection.style.width = px(width);
        STATE.selection.style.height = px(height);
        STATE.selection.style.display = width > 0 && height > 0 ? "block" : "none";

        if (width > 0 && height > 0) {
            STATE.info.style.display = "block";
            STATE.info.textContent = `${Math.round(width)} × ${Math.round(height)}`;
            const infoLeft = clamp(left + width + 8, 8, window.innerWidth - 8 - 120);
            const infoTop = clamp(top + height + 8, 8, window.innerHeight - 8 - 24);
            STATE.info.style.left = px(infoLeft);
            STATE.info.style.top = px(infoTop);
        } else {
            STATE.info.style.display = "none";
        }
    }

    function removeOverlay() {
        try {
            STATE.cleanupFns.forEach((fn) => {
                try { fn(); } catch (_) {}
            });
            STATE.cleanupFns = [];
            if (STATE.overlay && STATE.overlay.parentNode) {
                STATE.overlay.parentNode.removeChild(STATE.overlay);
            }
        } finally {
            STATE.overlay = null;
            STATE.mask = null;
            STATE.selection = null;
            STATE.info = null;
            STATE.isSelecting = false;
            document.documentElement.style.userSelect = STATE.prevUserSelect;
            window.__regionScreenshotActive = false;
        }
    }

    function showToast(message) {
        const toast = document.createElement("div");
        toast.textContent = message;
        toast.style.position = "fixed";
        toast.style.left = "50%";
        toast.style.top = "16px";
        toast.style.transform = "translateX(-50%)";
        toast.style.background = "rgba(0,0,0,0.8)";
        toast.style.color = "#fff";
        toast.style.padding = "8px 12px";
        toast.style.borderRadius = "8px";
        toast.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        toast.style.fontSize = "13px";
        toast.style.zIndex = "2147483647";
        toast.style.pointerEvents = "none";
        document.documentElement.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 1800);
    }

    async function delayTwoFrames() {
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
    }

    async function captureAndSaveCrop(left, top, width, height) {
        if (width < 5 || height < 5) {
            removeOverlay();
            return;
        }

        // Hide overlay from capture
        STATE.overlay.style.display = "none";
        await delayTwoFrames();

        const capture = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
        if (!capture || !capture.ok || !capture.dataUrl) {
            showToast("Capture failed");
            removeOverlay();
            return;
        }

        const image = new Image();
        image.src = capture.dataUrl;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
        });

        const scaleX = image.naturalWidth / window.innerWidth;
        const scaleY = image.naturalHeight / window.innerHeight;

        const sx = Math.round(left * scaleX);
        const sy = Math.round(top * scaleY);
        const sWidth = Math.round(width * scaleX);
        const sHeight = Math.round(height * scaleY);

        const canvas = document.createElement("canvas");
        canvas.width = sWidth;
        canvas.height = sHeight;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

        const dataUrl = canvas.toDataURL("image/png");

        const res = await chrome.runtime.sendMessage({ type: "STORE_IMAGE", dataUrl });
        if (!(res && res.ok)) {
            showToast("Capture failed");
        }

        removeOverlay();
    }

    function startSelection() {
        if (STATE.isSelecting) return;
        STATE.isSelecting = true;
        STATE.prevUserSelect = document.documentElement.style.userSelect;
        document.documentElement.style.userSelect = "none";
        createOverlayElements();

        const onMouseDown = (e) => {
            if (e.button !== 0) return; // left click only
            e.preventDefault();
            STATE.startX = clamp(e.clientX, 0, window.innerWidth - 1);
            STATE.startY = clamp(e.clientY, 0, window.innerHeight - 1);
            STATE.currentX = STATE.startX;
            STATE.currentY = STATE.startY;
            updateSelectionBox();
            const move = (ev) => {
                STATE.currentX = clamp(ev.clientX, 0, window.innerWidth - 1);
                STATE.currentY = clamp(ev.clientY, 0, window.innerHeight - 1);
                updateSelectionBox();
            };
            const up = (ev) => {
                document.removeEventListener("mousemove", move, true);
                document.removeEventListener("mouseup", up, true);
                STATE.currentX = clamp(ev.clientX, 0, window.innerWidth - 1);
                STATE.currentY = clamp(ev.clientY, 0, window.innerHeight - 1);
                updateSelectionBox();
                const left = Math.min(STATE.startX, STATE.currentX);
                const top = Math.min(STATE.startY, STATE.currentY);
                const width = Math.abs(STATE.currentX - STATE.startX);
                const height = Math.abs(STATE.currentY - STATE.startY);
                captureAndSaveCrop(left, top, width, height);
            };
            document.addEventListener("mousemove", move, true);
            document.addEventListener("mouseup", up, true);
            STATE.cleanupFns.push(() => {
                document.removeEventListener("mousemove", move, true);
                document.removeEventListener("mouseup", up, true);
            });
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                removeOverlay();
            }
        };

        // Failsafe: if the tab loses focus or visibility (e.g., popup opens), end selection
        const onBlur = () => {
            removeOverlay();
        };
        const onVisibility = () => {
            if (document.hidden) {
                removeOverlay();
            }
        };

        STATE.overlay.addEventListener("mousedown", onMouseDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onBlur, true);
        document.addEventListener("visibilitychange", onVisibility, true);
        STATE.cleanupFns.push(() => STATE.overlay && STATE.overlay.removeEventListener("mousedown", onMouseDown, true));
        STATE.cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown, true));
        STATE.cleanupFns.push(() => window.removeEventListener("blur", onBlur, true));
        STATE.cleanupFns.push(() => document.removeEventListener("visibilitychange", onVisibility, true));
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === "START_SELECTION") {
            try {
                startSelection();
            } catch (err) {
                // Fail silently
            }
        } else if (message && message.type === "END_SELECTION") {
            try {
                // Force cleanup if overlay still present
                if (STATE && STATE.overlay) {
                    removeOverlay();
                } else {
                    // Ensure global flag is reset even if overlay element is gone
                    window.__regionScreenshotActive = false;
                    document.documentElement.style.userSelect = "";
                }
            } catch (_) {
                // ignore
            }
        }
    });
})();