/* Popup logic for Region Screenshot */
(function() {
    const captureBtn = document.getElementById("captureBtn");
    const canvas = document.getElementById("resultCanvas");
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("overlayCanvas");

    // Calibration UI
    const calPanel = document.getElementById("calibrationPanel");
    const calMessage = document.getElementById("calMessage");
    const calInputRow = document.getElementById("calInputRow");
    const calLabel = document.getElementById("calLabel");
    const calValueInput = document.getElementById("calValueInput");
    const calSubmitBtn = document.getElementById("calSubmitBtn");
    const calResults = document.getElementById("calResults");
    const xPointsList = document.getElementById("xPointsList");
    const yPointsList = document.getElementById("yPointsList");
    const hoverReadout = document.getElementById("hoverReadout");
    const measureSlopeBtn = document.getElementById("measureSlopeBtn");

    const calibState = {
        phase: "idle", // 'idle' | 'await-points' | 'done'
        axes: null,
        xBasis: null,
        yBasis: null,
        aX: null,
        bX: null,
        aY: null,
        bY: null,
        markers: [], // { id, kind: 'x'|'y', click:{x,y}, proj:{x,y}, t:number, value:number|null }
        nextMarkerId: 1,
        hoverPoint: null,
        axisDrawStartPoint: null,
        measure: {
            mode: "idle", // 'idle' | 'slope-wait-pt1' | 'slope-wait-pt2' | 'done'
            points: [], // [{ p:{x,y}, xVal:number|null, yVal:number|null }]
            slope: null,
            dx: null,
            dy: null
        }
    };

    function resetCalibrationState() {
        calibState.phase = "draw-x-pt1";
        calibState.axes = null;
        calibState.xBasis = null;
        calibState.yBasis = null;
        calibState.aX = null;
        calibState.bX = null;
        calibState.aY = null;
        calibState.bY = null;
        calibState.markers = [];
        calibState.axisDrawStartPoint = null;
        calMessage.textContent = "Draw X-axis: click first point.";
        calInputRow.classList.add("hidden");
        calResults.textContent = "";
    }

    function updateCalMessage(text) {
        calMessage.textContent = text;
    }

    let pendingSubmitHandler = null;

    function showPrompt(label, onSubmit) {
        calLabel.textContent = label;
        calValueInput.value = "";
        calInputRow.classList.remove("hidden");
        calValueInput.focus();
        pendingSubmitHandler = onSubmit;
    }

    calSubmitBtn.addEventListener("click", () => {
        if (!pendingSubmitHandler) return;
        const v = parseFloat(calValueInput.value);
        if (!Number.isFinite(v)) {
            calValueInput.focus();
            return;
        }
        const handler = pendingSubmitHandler;
        pendingSubmitHandler = null;
        calInputRow.classList.add("hidden");
        handler(v);
    });
    calValueInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            calSubmitBtn.click();
        }
    });

    function getCanvasCoords(evt) {
        const rect = canvas.getBoundingClientRect();
        const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
        const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
        return { x, y };
    }

    function getAxisBasis(line, origin) {
        const ax = line.x1,
            ay = line.y1;
        const bx = line.x2,
            by = line.y2;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const basis = {
            origin: origin ? { x: origin.x, y: origin.y } : { x: ax, y: ay },
            ux: dx / len,
            uy: dy / len,
            length: len
        };
        return basis;
    }

    function projectPointToAxis(p, basis) {
        const vx = p.x - basis.origin.x;
        const vy = p.y - basis.origin.y;
        const t = vx * basis.ux + vy * basis.uy; // pixels along axis from origin
        const proj = { x: basis.origin.x + t * basis.ux, y: basis.origin.y + t * basis.uy };
        return { t, proj };
    }

    function intersectionOfLines(l1, l2) {
        const x1 = l1.x1,
            y1 = l1.y1,
            x2 = l1.x2,
            y2 = l1.y2;
        const x3 = l2.x1,
            y3 = l2.y1,
            x4 = l2.x2,
            y4 = l2.y2;
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-6) return null;
        const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
        const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
        return { x: px, y: py };
    }

    function distancePointToLine(p, line) {
        const x1 = line.x1,
            y1 = line.y1,
            x2 = line.x2,
            y2 = line.y2;
        const num = Math.abs((y2 - y1) * p.x - (x2 - x1) * p.y + x2 * y1 - y2 * x1);
        const den = Math.hypot(y2 - y1, x2 - x1) || 1;
        return num / den;
    }

    function formatNumber(v) {
        if (!Number.isFinite(v)) return '—';
        const abs = Math.abs(v);
        if (abs >= 1e5 || (abs !== 0 && abs < 1e-3)) return v.toExponential(3);
        return (Math.round(v * 1e6) / 1e6).toString();
    }

    function pixelToValues(p) {
        let xVal = null;
        let yVal = null;
        if (calibState.axes && Number.isFinite(calibState.aX) && Number.isFinite(calibState.bX) && calibState.xBasis) {
            const { t } = projectPointToAxis(p, calibState.xBasis);
            xVal = calibState.aX * t + calibState.bX;
        }
        if (calibState.axes && Number.isFinite(calibState.aY) && Number.isFinite(calibState.bY) && calibState.yBasis) {
            const { t } = projectPointToAxis(p, calibState.yBasis);
            yVal = calibState.aY * t + calibState.bY;
        }
        return { xVal, yVal };
    }

    function displayResults() {
        const parts = [];
        if (Number.isFinite(calibState.aX) && Number.isFinite(calibState.bX)) {
            parts.push(`X mapping: x = ${calibState.aX} * t + ${calibState.bX}`);
        }
        if (Number.isFinite(calibState.aY) && Number.isFinite(calibState.bY)) {
            parts.push(`Y mapping: y = ${calibState.aY} * t + ${calibState.bY}`);
        }
        if (calibState.measure && Number.isFinite(calibState.measure.slope)) {
            const m = calibState.measure;
            parts.push(`Slope: ${formatNumber(m.slope)} (Δy=${formatNumber(m.dy)}, Δx=${formatNumber(m.dx)})`);
        }
        calResults.textContent = parts.join("\n");
    }

    function redrawOverlay(lines, width, height, axes) {
        const octx = overlay.getContext('2d');
        overlay.width = width;
        overlay.height = height;
        octx.clearRect(0, 0, width, height);

        // Draw in-progress axis preview line while waiting for second point
        if ((calibState.phase === "draw-x-pt2" || calibState.phase === "draw-y-pt2") && calibState.axisDrawStartPoint && calibState.hoverPoint) {
            octx.save();
            octx.beginPath();
            octx.setLineDash([6, 4]);
            octx.lineWidth = 2;
            octx.strokeStyle = calibState.phase === "draw-x-pt2" ? 'rgba(255, 99, 71, 0.9)' : 'rgba(255, 215, 0, 0.9)';
            octx.moveTo(calibState.axisDrawStartPoint.x, calibState.axisDrawStartPoint.y);
            octx.lineTo(calibState.hoverPoint.x, calibState.hoverPoint.y);
            octx.stroke();
            octx.setLineDash([]);
            octx.beginPath();
            octx.fillStyle = 'rgba(0,0,0,0.5)';
            octx.arc(calibState.axisDrawStartPoint.x, calibState.axisDrawStartPoint.y, 3.5, 0, Math.PI * 2);
            octx.fill();
            octx.restore();
        }

        // Draw suggested axes
        if (axes && axes.xAxis) {
            octx.beginPath();
            octx.lineWidth = 4;
            octx.strokeStyle = 'rgba(255, 99, 71, 1)';
            octx.moveTo(axes.xAxis.x1, axes.xAxis.y1);
            octx.lineTo(axes.xAxis.x2, axes.xAxis.y2);
            octx.stroke();
        }
        if (axes && axes.yAxis) {
            octx.beginPath();
            octx.lineWidth = 4;
            octx.strokeStyle = 'rgba(255, 215, 0, 1)';
            octx.moveTo(axes.yAxis.x1, axes.yAxis.y1);
            octx.lineTo(axes.yAxis.x2, axes.yAxis.y2);
            octx.stroke();
        }

        // Draw calibration markers
        for (const m of calibState.markers) {
            const color = m.kind === 'x' ? 'rgba(59,130,246,0.9)' : 'rgba(16,185,129,0.9)';
            const lineColor = m.kind === 'x' ? 'rgba(59,130,246,0.5)' : 'rgba(16,185,129,0.5)';

            // line from click to projection
            octx.beginPath();
            octx.strokeStyle = lineColor;
            octx.lineWidth = 2;
            octx.moveTo(m.click.x, m.click.y);
            octx.lineTo(m.proj.x, m.proj.y);
            octx.stroke();

            // projected point
            octx.beginPath();
            octx.fillStyle = color;
            octx.arc(m.proj.x, m.proj.y, 4, 0, Math.PI * 2);
            octx.fill();

            // click point
            octx.beginPath();
            octx.fillStyle = 'rgba(0,0,0,0.35)';
            octx.arc(m.click.x, m.click.y, 3, 0, Math.PI * 2);
            octx.fill();
        }

        // Hover indicator
        if (calibState.hoverPoint) {
            const p = calibState.hoverPoint;
            octx.beginPath();
            octx.fillStyle = 'rgba(0,0,0,0.6)';
            octx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
            octx.fill();
        }

        // Measurement (slope) points and connecting line
        if (calibState.measure && calibState.measure.points.length > 0) {
            const pts = calibState.measure.points;
            if (pts.length >= 2) {
                octx.beginPath();
                octx.strokeStyle = 'rgba(188,0,255,0.9)';
                octx.lineWidth = 2.5;
                octx.moveTo(pts[0].p.x, pts[0].p.y);
                octx.lineTo(pts[1].p.x, pts[1].p.y);
                octx.stroke();
            }
            for (const it of pts) {
                octx.beginPath();
                octx.fillStyle = 'rgba(188,0,255,1)';
                octx.arc(it.p.x, it.p.y, 4.5, 0, Math.PI * 2);
                octx.fill();
            }
        }
    }

    function startAxesCalibration(axes, width, height) {
        resetCalibrationState();
        calibState.axes = axes;
        if (!(axes && axes.xAxis && axes.yAxis)) {
            updateCalMessage("Please draw both axes to proceed.");
            redrawOverlay([], width, height, axes);
            return;
        }
        const origin = intersectionOfLines(axes.xAxis, axes.yAxis) || { x: axes.xAxis.x1, y: axes.xAxis.y1 };
        calibState.xBasis = getAxisBasis(axes.xAxis, origin);
        calibState.yBasis = getAxisBasis(axes.yAxis, origin);
        updateCalMessage("Click one tick near the X-axis and one near the Y-axis.");
        calibState.phase = "await-points";
        redrawOverlay([], width, height, axes);
    }

    function getMarkersByKind(kind) {
        return calibState.markers.filter(m => m.kind === kind);
    }

    function recalcMappingForKind(kind) {
        const pts = getMarkersByKind(kind).filter(m => Number.isFinite(m.value));
        if (pts.length >= 2) {
            const t1 = pts[0].t,
                v1 = pts[0].value;
            const t2 = pts[1].t,
                v2 = pts[1].value;
            const denom = (t2 - t1);
            if (Math.abs(denom) > 1e-6) {
                const a = (v2 - v1) / denom;
                const b = v1 - a * t1;
                if (kind === 'x') {
                    calibState.aX = a;
                    calibState.bX = b;
                } else {
                    calibState.aY = a;
                    calibState.bY = b;
                }
            }
        } else if (pts.length === 1) {
            // Single point → assume intercept at axes intersection (t=0 => value=0)
            const t1 = pts[0].t,
                v1 = pts[0].value;
            if (Math.abs(t1) > 1e-6) {
                const a = v1 / t1;
                const b = 0;
                if (kind === 'x') {
                    calibState.aX = a;
                    calibState.bX = b;
                } else {
                    calibState.aY = a;
                    calibState.bY = b;
                }
            }
        } else {
            if (kind === 'x') {
                calibState.aX = null;
                calibState.bX = null;
            } else {
                calibState.aY = null;
                calibState.bY = null;
            }
        }
        displayResults();
    }

    function createPointItemDOM(marker) {
        const wrap = document.createElement('div');
        wrap.className = 'cal-item';

        const tLabel = document.createElement('div');
        tLabel.className = 't';
        tLabel.textContent = `t=${marker.t.toFixed(1)}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = marker.kind === 'x' ? 'x value' : 'y value';
        input.value = Number.isFinite(marker.value) ? String(marker.value) : '';
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            marker.value = Number.isFinite(v) ? v : null;
            recalcMappingForKind(marker.kind);
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'cal-remove-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
            calibState.markers = calibState.markers.filter(m => m.id !== marker.id);
            recalcMappingForKind(marker.kind);
            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            renderPointLists();
            const haveX = Number.isFinite(calibState.aX);
            const haveY = Number.isFinite(calibState.aY);
            if (!(haveX && haveY)) {
                calibState.phase = "await-points";
                updateCalMessage("Click one tick near the X-axis and one near the Y-axis.");
            }
        });

        wrap.appendChild(tLabel);
        wrap.appendChild(input);
        wrap.appendChild(removeBtn);
        return wrap;
    }

    function renderPointLists() {
        xPointsList.innerHTML = '';
        yPointsList.innerHTML = '';
        for (const m of getMarkersByKind('x')) {
            xPointsList.appendChild(createPointItemDOM(m));
        }
        for (const m of getMarkersByKind('y')) {
            yPointsList.appendChild(createPointItemDOM(m));
        }
    }

    function onCanvasClick(evt) {
        const p = getCanvasCoords(evt);

        // Handle slope measurement mode first (works with or without calibration)
        if (calibState.measure && (calibState.measure.mode === "slope-wait-pt1" || calibState.measure.mode === "slope-wait-pt2")) {
            const values = pixelToValues(p);
            calibState.measure.points.push({ p, xVal: values.xVal, yVal: values.yVal });

            if (calibState.measure.mode === "slope-wait-pt1") {
                calibState.measure.mode = "slope-wait-pt2";
                updateCalMessage("Slope: Click second point.");
            } else {
                // Compute slope
                const a = calibState.measure.points[0];
                const b = calibState.measure.points[1];
                let dx = null;
                let dy = null;
                let slope = null;
                if (Number.isFinite(a.xVal) && Number.isFinite(b.xVal) && Number.isFinite(a.yVal) && Number.isFinite(b.yVal)) {
                    dx = b.xVal - a.xVal;
                    dy = b.yVal - a.yVal;
                    slope = (Math.abs(dx) > 1e-12) ? (dy / dx) : (dx === 0 ? Infinity : null);
                } else {
                    // Fallback to pixel-based (with y positive up) if not calibrated
                    const dxPx = b.p.x - a.p.x;
                    const dyPx = a.p.y - b.p.y; // invert to make up positive
                    dx = dxPx;
                    dy = dyPx;
                    slope = (Math.abs(dxPx) > 1e-12) ? (dyPx / dxPx) : (dxPx === 0 ? Infinity : null);
                }
                calibState.measure.dx = dx;
                calibState.measure.dy = dy;
                calibState.measure.slope = slope;
                calibState.measure.mode = "done";
                updateCalMessage("Slope measured. Click “Measure slope” to start again.");
                displayResults();
            }

            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            return;
        }

        // Manual axis drawing flow
        if (calibState.phase === "draw-x-pt1") {
            calibState.axisDrawStartPoint = p;
            calibState.phase = "draw-x-pt2";
            updateCalMessage("Draw X-axis: click second point.");
            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            return;
        } else if (calibState.phase === "draw-x-pt2") {
            const p1 = calibState.axisDrawStartPoint;
            const xAxis = { x1: p1.x, y1: p1.y, x2: p.x, y2: p.y };
            calibState.axes = { xAxis, yAxis: calibState.axes && calibState.axes.yAxis ? calibState.axes.yAxis : null };
            calibState.axisDrawStartPoint = null;
            calibState.phase = "draw-y-pt1";
            updateCalMessage("Draw Y-axis: click first point.");
            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            return;
        } else if (calibState.phase === "draw-y-pt1") {
            calibState.axisDrawStartPoint = p;
            calibState.phase = "draw-y-pt2";
            updateCalMessage("Draw Y-axis: click second point.");
            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            return;
        } else if (calibState.phase === "draw-y-pt2") {
            const p1 = calibState.axisDrawStartPoint;
            const yAxis = { x1: p1.x, y1: p1.y, x2: p.x, y2: p.y };
            const xAxis = calibState.axes && calibState.axes.xAxis ? calibState.axes.xAxis : null;
            calibState.axes = { xAxis, yAxis };
            calibState.axisDrawStartPoint = null;
            startAxesCalibration(calibState.axes, canvas.width, canvas.height);
            return;
        }

        // Calibration flow (assign values to one tick per axis)
        if (calibState.phase === "idle" || calibState.phase === "done") return;

        if (calibState.phase === "await-points") {
            // Decide axis by proximity
            const dx = distancePointToLine(p, calibState.axes.xAxis);
            const dy = distancePointToLine(p, calibState.axes.yAxis);
            const kind = (dx < dy) ? 'x' : 'y';
            if (getMarkersByKind(kind).length >= 1) {
                updateCalMessage(kind === 'x' ? "X point already set. Click near the Y-axis or remove the X point." : "Y point already set. Click near the X-axis or remove the Y point.");
                return;
            }
            const basis = kind === 'x' ? calibState.xBasis : calibState.yBasis;
            const { t, proj } = projectPointToAxis(p, basis);
            const id = calibState.nextMarkerId++;
            const marker = { id, kind, click: p, proj, t, value: null };
            calibState.markers.push(marker);
            redrawOverlay([], canvas.width, canvas.height, calibState.axes);
            renderPointLists();
            showPrompt(kind === 'x' ? "What is x at this point?" : "What is y at this point?", (val) => {
                marker.value = val;
                recalcMappingForKind(kind);
                renderPointLists();
                const haveX = Number.isFinite(calibState.aX);
                const haveY = Number.isFinite(calibState.aY);
                if (haveX && haveY) {
                    updateCalMessage("Calibration complete. Hover to see (X, Y).");
                    calibState.phase = "done";
                } else {
                    updateCalMessage(haveX ? "X set. Now click a tick near the Y-axis." : "Y set. Now click a tick near the X-axis.");
                }
            });
            return;
        }
    }

    canvas.addEventListener("click", onCanvasClick);

    function onCanvasMouseMove(evt) {
        const p = getCanvasCoords(evt);
        calibState.hoverPoint = p;
        // Compute hover values when mappings exist
        let xStr = '—',
            yStr = '—';
        const fmt = (v) => {
            if (!Number.isFinite(v)) return '—';
            const abs = Math.abs(v);
            if (abs >= 1e5 || (abs !== 0 && abs < 1e-3)) return v.toExponential(3);
            return (Math.round(v * 1e6) / 1e6).toString();
        };
        if (Number.isFinite(calibState.aX) && Number.isFinite(calibState.bX)) {
            const { t } = projectPointToAxis(p, calibState.xBasis);
            const xVal = calibState.aX * t + calibState.bX;
            xStr = fmt(xVal);
        }
        if (Number.isFinite(calibState.aY) && Number.isFinite(calibState.bY)) {
            const { t } = projectPointToAxis(p, calibState.yBasis);
            const yVal = calibState.aY * t + calibState.bY;
            yStr = fmt(yVal);
        }
        hoverReadout.textContent = `Hover x: ${xStr}, y: ${yStr}`;
        redrawOverlay([], canvas.width, canvas.height, calibState.axes);
    }

    function onCanvasMouseLeave() {
        calibState.hoverPoint = null;
        hoverReadout.textContent = "Hover x: —, y: —";
        redrawOverlay([], canvas.width, canvas.height, calibState.axes);
    }

    canvas.addEventListener("mousemove", onCanvasMouseMove);
    canvas.addEventListener("mouseleave", onCanvasMouseLeave);

    function startMeasureSlope() {
        // Reset measurement state and prompt
        calibState.measure = {
            mode: "slope-wait-pt1",
            points: [],
            slope: null,
            dx: null,
            dy: null
        };
        updateCalMessage("Slope: Click first point.");
        displayResults();
        redrawOverlay([], canvas.width, canvas.height, calibState.axes);
    }

    function drawDataUrlToCanvas(dataUrl) {
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            // Begin manual axes flow
            resetCalibrationState();
            redrawOverlay([], canvas.width, canvas.height, null);
        };
        img.src = dataUrl;
    }

    function lineLength(line) {
        const dx = line.x2 - line.x1;
        const dy = line.y2 - line.y1;
        return Math.hypot(dx, dy);
    }

    function drawLinesOnOverlay(lines, width, height, axes) {
        // Kept for backward compatibility; now delegates to redrawOverlay
        redrawOverlay(lines, width, height, axes);
    }

    function mergeSimilarLines(lines, rhoTolerance = 5, angleToleranceDeg = 3) {
        const angleTol = angleToleranceDeg * Math.PI / 180;
        const merged = [];

        for (const line of lines) {
            let foundCluster = false;

            for (const cluster of merged) {
                const dTheta = Math.abs(line.theta - cluster.theta);
                const dRho = Math.abs(line.rho - cluster.rho);

                if (dTheta < angleTol && dRho < rhoTolerance) {
                    // merge by averaging weighted by votes+length
                    const w1 = cluster.votes * lineLength(cluster);
                    const w2 = line.votes * lineLength(line);
                    const wSum = w1 + w2;

                    cluster.theta = (cluster.theta * w1 + line.theta * w2) / wSum;
                    cluster.rho = (cluster.rho * w1 + line.rho * w2) / wSum;
                    cluster.votes += line.votes;
                    // endpoints can be recomputed later from theta/rho if you want
                    foundCluster = true;
                    break;
                }
            }

            if (!foundCluster) {
                merged.push({...line });
            }
        }

        return merged;
    }


    function computeEdgeMapFromCanvas(canvas, ctx) {
        const width = canvas.width;
        const height = canvas.height;

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data; // [r,g,b,a,r,g,b,a,...]

        const gray = new Float32Array(width * height);
        const edges = new Uint8Array(width * height);

        // 1) Grayscale
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // luminance
            gray[j] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        // 2) Sobel kernels
        const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];

        const sobelY = [-1, -2, -1,
            0, 0, 0,
            1, 2, 1
        ];

        // 3) Compute gradient magnitude, simple threshold to get edges
        const threshold = 80; // you can tweak this

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0;
                let gy = 0;
                let k = 0;

                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const px = x + kx;
                        const py = y + ky;
                        const idx = py * width + px;
                        const val = gray[idx];

                        gx += sobelX[k] * val;
                        gy += sobelY[k] * val;
                        k++;
                    }
                }

                const mag = Math.sqrt(gx * gx + gy * gy);
                const idxCenter = y * width + x;
                edges[idxCenter] = mag > threshold ? 1 : 0;
            }
        }

        return edges;
    }

    /**
     * Run a Hough transform on a binary edge map to detect strong straight lines.
     * edges: Uint8Array of length width * height, where 1 = edge, 0 = no edge
     * Returns an array of DetectedLine objects with endpoints for drawing.
     */
    function houghLines(edges, width, height, options = {}) {
        const {
            thetaStepDeg = 1,
                rhoStep = 1,
                angleMarginDeg = 10,
                voteThreshold = 80, // tweak based on image size
                maxLines = 20, // how many strongest lines to keep
                sampleStep = 1 // skip pixels for speed (1 = no skip)
        } = options;

        const diag = Math.hypot(width, height);
        const rhoMax = diag;
        const numRho = Math.ceil((2 * rhoMax) / rhoStep);

        // 1) Build list of theta values (near horizontal & near vertical)
        const thetas = [];
        const deg2rad = d => d * Math.PI / 180;

        // Horizontal-ish: around 0°
        for (let d = -angleMarginDeg; d <= angleMarginDeg; d += thetaStepDeg) {
            thetas.push(deg2rad(d));
        }
        // Vertical-ish: around 90°
        for (let d = 90 - angleMarginDeg; d <= 90 + angleMarginDeg; d += thetaStepDeg) {
            thetas.push(deg2rad(d));
        }

        const numTheta = thetas.length;

        // 2) Precompute cos/sin
        const cosTable = new Float32Array(numTheta);
        const sinTable = new Float32Array(numTheta);
        for (let i = 0; i < numTheta; i++) {
            cosTable[i] = Math.cos(thetas[i]);
            sinTable[i] = Math.sin(thetas[i]);
        }

        // 3) Allocate accumulator[thetaIndex][rhoIndex]
        const accumulator = Array.from({ length: numTheta }, () =>
            new Uint32Array(numRho)
        );

        const rhoToIndex = rho => Math.round((rho + rhoMax) / rhoStep);

        // 4) Vote for lines
        for (let y = 0; y < height; y += sampleStep) {
            for (let x = 0; x < width; x += sampleStep) {
                const idx = y * width + x;
                if (!edges[idx]) continue; // not an edge pixel

                for (let ti = 0; ti < numTheta; ti++) {
                    const rho = x * cosTable[ti] + y * sinTable[ti];
                    const ri = rhoToIndex(rho);
                    if (ri >= 0 && ri < numRho) {
                        accumulator[ti][ri]++;
                    }
                }
            }
        }

        // 5) Find peaks in accumulator
        const peaks = findHoughPeaks(accumulator, thetas, rhoStep, rhoMax, voteThreshold);

        // 6) Convert to finite segments in image coords
        const detectedLines = [];
        for (let i = 0; i < peaks.length && detectedLines.length < maxLines; i++) {
            const hLine = peaks[i];
            const segment = houghLineToSegment(hLine.theta, hLine.rho, width, height);
            if (!segment) continue;

            const orientation = classifyOrientation(hLine.theta);

            detectedLines.push({
                theta: hLine.theta,
                rho: hLine.rho,
                votes: hLine.votes,
                x1: segment.x1,
                y1: segment.y1,
                x2: segment.x2,
                y2: segment.y2,
                orientation // 'horizontal' or 'vertical'
            });
        }

        const maxDim = Math.max(width, height);
        const minAxisLength = 0.6 * maxDim; // axes should span most of the plot

        const filtered = detectedLines.filter(line => {
            const len = lineLength(line);
            // require both: long enough and enough votes
            return len >= minAxisLength && line.votes >= options.voteThreshold;
        });

        return filtered;
    }

    /**
     * Find local maxima in the Hough accumulator.
     */
    function findHoughPeaks(accumulator, thetas, rhoStep, rhoMax, voteThreshold) {
        const lines = [];
        const numTheta = accumulator.length;
        const numRho = accumulator[0].length;

        for (let ti = 0; ti < numTheta; ti++) {
            const row = accumulator[ti];
            for (let ri = 0; ri < numRho; ri++) {
                const votes = row[ri];
                if (votes < voteThreshold) continue;

                // Simple 1D local max check along rho dimension
                const left = ri > 0 ? row[ri - 1] : 0;
                const right = ri < numRho - 1 ? row[ri + 1] : 0;
                if (votes >= left && votes >= right) {
                    const theta = thetas[ti];
                    const rho = ri * rhoStep - rhoMax;
                    lines.push({ thetaIndex: ti, rhoIndex: ri, theta, rho, votes });
                }
            }
        }

        // Sort by votes, strongest first
        lines.sort((a, b) => b.votes - a.votes);
        return lines;
    }

    /**
     * Convert (theta, rho) Hough params into a finite segment clipped to image.
     */
    function houghLineToSegment(theta, rho, width, height) {
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const points = [];

        // x = 0 → solve for y
        if (Math.abs(sinT) > 1e-6) {
            const y0 = (rho - 0 * cosT) / sinT;
            if (y0 >= 0 && y0 <= height) points.push({ x: 0, y: y0 });
        }

        // x = width
        if (Math.abs(sinT) > 1e-6) {
            const yW = (rho - width * cosT) / sinT;
            if (yW >= 0 && yW <= height) points.push({ x: width, y: yW });
        }

        // y = 0 → solve for x
        if (Math.abs(cosT) > 1e-6) {
            const x0 = (rho - 0 * sinT) / cosT;
            if (x0 >= 0 && x0 <= width) points.push({ x: x0, y: 0 });
        }

        // y = height
        if (Math.abs(cosT) > 1e-6) {
            const xH = (rho - height * sinT) / cosT;
            if (xH >= 0 && xH <= width) points.push({ x: xH, y: height });
        }

        if (points.length < 2) return null;

        // Pick the two farthest points to get the longest visible segment
        let bestPair = [0, 1];
        let bestDist = -1;
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dx = points[i].x - points[j].x;
                const dy = points[i].y - points[j].y;
                const d2 = dx * dx + dy * dy;
                if (d2 > bestDist) {
                    bestDist = d2;
                    bestPair = [i, j];
                }
            }
        }

        const [i, j] = bestPair;
        return {
            x1: points[i].x,
            y1: points[i].y,
            x2: points[j].x,
            y2: points[j].y
        };
    }

    /**
     * Classify orientation from theta (roughly horizontal vs vertical).
     */
    function classifyOrientation(theta) {
        const deg = Math.abs(theta * 180 / Math.PI) % 180;
        // Close to 0° or 180° → horizontal; close to 90° → vertical
        const distToHorizontal = Math.min(deg, 180 - deg);
        const distToVertical = Math.abs(deg - 90);
        return (distToHorizontal < distToVertical) ? 'horizontal' : 'vertical';
    }

    // Axis suggestion helpers
    function lineAngleFromHorizontal(line) {
        const dx = Math.abs(line.x2 - line.x1);
        const dy = Math.abs(line.y2 - line.y1);
        return Math.atan2(dy, dx); // 0 = horizontal, pi/2 = vertical
    }

    function suggestAxes(lines, width, height) {
        if (!lines || !lines.length) return { xAxis: null, yAxis: null };
        const maxLen = Math.max(...lines.map(lineLength));
        const maxVotes = Math.max(...lines.map(l => l.votes || 1));

        function scoreForHorizontal(line) {
            const angle = lineAngleFromHorizontal(line);
            const angleCloseness = 1 - (angle / (Math.PI / 2)); // 1 when perfectly horizontal
            const lenFactor = lineLength(line) / (maxLen || 1);
            const voteFactor = (line.votes || 0) / (maxVotes || 1);
            return 0.6 * angleCloseness + 0.25 * lenFactor + 0.15 * voteFactor;
        }

        function scoreForVertical(line) {
            const angle = lineAngleFromHorizontal(line);
            const angleCloseness = 1 - (Math.abs((Math.PI / 2) - angle) / (Math.PI / 2)); // 1 when perfectly vertical
            const lenFactor = lineLength(line) / (maxLen || 1);
            const voteFactor = (line.votes || 0) / (maxVotes || 1);
            return 0.6 * angleCloseness + 0.25 * lenFactor + 0.15 * voteFactor;
        }

        let bestH = null;
        let bestHScore = -Infinity;
        let bestV = null;
        let bestVScore = -Infinity;

        for (const line of lines) {
            const hScore = scoreForHorizontal(line);
            if (hScore > bestHScore) {
                bestHScore = hScore;
                bestH = line;
            }
            const vScore = scoreForVertical(line);
            if (vScore > bestVScore) {
                bestVScore = vScore;
                bestV = line;
            }
        }

        // If both pick the same segment, pick next-best vertical
        if (bestH && bestV && bestH === bestV) {
            let secondBestV = null;
            let secondBestVScore = -Infinity;
            for (const line of lines) {
                if (line === bestV) continue;
                const vScore = scoreForVertical(line);
                if (vScore > secondBestVScore) {
                    secondBestVScore = vScore;
                    secondBestV = line;
                }
            }
            if (secondBestV) bestV = secondBestV;
        }

        return { xAxis: bestH, yAxis: bestV };
    }

    async function startCaptureFlow() {
        try {
            await chrome.runtime.sendMessage({ type: "START_CAPTURE_FLOW" });
        } catch (_) {
            // ignore
        }
        window.close();
    }

    captureBtn.addEventListener("click", startCaptureFlow);
    if (measureSlopeBtn) {
        measureSlopeBtn.addEventListener("click", startMeasureSlope);
    }

    // Populate canvas with last capture, if any
    chrome.storage.local.get("lastCaptureDataUrl", (items) => {
        const dataUrl = items && items.lastCaptureDataUrl;
        if (dataUrl) drawDataUrlToCanvas(dataUrl);
    });
})();