// ==UserScript==
// @name           Sauruman Lite
// @namespace      http://tampermonkey.net/
// @version        1.1.4
// @description    11.08.2025
// @author         Bruno Ulrich Fischer
// @supportURL     mailto://brunfisc@amazon.de
// @updateURL      https://github.com/GrumpySanta93/Sauruman-Lite/raw/refs/heads/main/sauruman-lite.user.js
// @downloadURL    https://github.com/GrumpySanta93/Sauruman-Lite/raw/refs/heads/main/sauruman-lite.user.js
// @match          https://flow-sortation-eu.amazon.com/HAJ1/*
// @grant          none
// ==/UserScript==

(function () {
    'use strict';

    let lastHash = '';
    let reloadInterval = null;
    let countdownInterval = null;
    let countdownValue = 0;

    const autosortGroup = [
        'dz-P-AUTOSORT', 'dz-P-AUTOSORT_5LB_OVERFLOW_TO_20LB', 'dz-P-AUTOSORT_20_LBS',
        'dz-P-AUTOSORT_LOWQTY', 'dz-P-AUTOSORT_20_LBS_LOWQTY', 'dz-P-AUTOSORT_BUFFERING'
    ];
    const mansortGroup = [
        'dz-P-MANSORT', 'dz-P-COMMONSORT', 'dz-P-COMMONSORT_LOWQTY', 'dz-P-MANSORTTOTE',
        'dz-P-COMMONSORT_20LB_LOWQTY', 'dz-P-COMMONSORT_20LB', 'dz-P-UIS_SIDELINE_TOTE',
        'dz-P-DECANT', 'dz-P-PRIME', 'dz-P-MANSORT_LIQUIDS', 'dz-P-SORT'
    ];

    function extractRouting(msg, groupEnabled) {
        const dzMatch = msg.match(/dz-P-([^,]+)/);
        const pkMatch = msg.match(/pkTRANS[^,]*Case([^,]+)/);
        const route = dzMatch ? `dz-P-${dzMatch[1]}` : pkMatch ? `pkTRANSCase${pkMatch[1]}` : null;
        if (groupEnabled) {
            if (autosortGroup.includes(route)) return 'Autosort';
            if (mansortGroup.includes(route)) return 'Mansort';
        }
        return route;
    }

    function loadTrendData() {
        try {
            return JSON.parse(localStorage.getItem('saurumanTrendCache') || '{}');
        } catch {
            return {};
        }
    }

    function saveTrendData(data) {
        localStorage.setItem('saurumanTrendCache', JSON.stringify(data));
        localStorage.setItem('saurumanTrendInitialized', 'true');
    }

    function getTrendArrow(pid, routing, percent, previousData) {
        const trendReady = localStorage.getItem('saurumanTrendInitialized') === 'true';
        const showTrends = localStorage.getItem('saurumanShowTrends') === 'true';
        if (!trendReady || !showTrends) return '';
        const oldPercent = previousData?.[pid]?.[routing];
        if (oldPercent == null) return '';
        if (percent > oldPercent) return ' ↗';
        if (percent < oldPercent) return ' ↘';
        return ' →';
    }

    function countRoutingsByPID() {
        const groupEnabled = localStorage.getItem('saurumanGroupRouting') === 'true';
        const layoutCols = parseInt(localStorage.getItem('saurumanLayoutCols') || '1', 10);
        const layoutRows = parseInt(localStorage.getItem('saurumanLayoutRows') || '6', 10);
        const showTrends = localStorage.getItem('saurumanShowTrends') === 'true';

        const rows = document.querySelectorAll('table tbody tr');
        const data = {
            PID2: { uniqueRoutings: new Set(), packageCount: 0, routingMap: {} },
            PID3: { uniqueRoutings: new Set(), packageCount: 0, routingMap: {} },
            PID4: { uniqueRoutings: new Set(), packageCount: 0, routingMap: {} },
            PID5: { uniqueRoutings: new Set(), packageCount: 0, routingMap: {} },
            PID6: { uniqueRoutings: new Set(), packageCount: 0, routingMap: {} },
        };
        const pidRegex = /RC0(\d)/;

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            for (let td of cells) {
                const text = td.textContent;
                const routing = extractRouting(text, groupEnabled);
                const pidMatch = text.match(pidRegex);
                if (routing && pidMatch && pidMatch[1]) {
                    const pid = pidMatch[1];
                    const key = `PID${pid}`;
                    if (data[key]) {
                        data[key].uniqueRoutings.add(routing);
                        data[key].packageCount++;
                        data[key].routingMap[routing] = (data[key].routingMap[routing] || 0) + 1;
                    }
                    break;
                }
            }
        });

        const prevTrends = loadTrendData();
        const newTrends = {};
        const section = document.getElementById('pidSection');
        if (!section) return;
        section.innerHTML = '';
        const limit = parseInt(localStorage.getItem('saurumanRoutingLimit') || '3', 10);

        const allBlocks = Object.entries(data).map(([pid, obj]) => {
            const total = obj.packageCount;
            const uniqueCount = obj.uniqueRoutings.size;
            const pidBlock = document.createElement('div');
            pidBlock.style.borderTop = '1px solid #ccc';
            pidBlock.style.marginTop = '8px';
            pidBlock.style.paddingRight = '10px';
            pidBlock.innerHTML = `<strong>${pid}:</strong> ${uniqueCount} Routings auf ${total} Pakete`;

            const sorted = Object.entries(obj.routingMap).sort((a, b) => b[1] - a[1]).slice(0, limit);
            newTrends[pid] = {};

            sorted.forEach(([routing, count]) => {
                const percent = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
                newTrends[pid][routing] = parseFloat(percent);
                const line = document.createElement('div');
                line.style.marginLeft = '12px';
                const displayName = routing.replace(/^dz-P-/, '').replace(/^pkTRANSCase/, '');
                const arrow = getTrendArrow(pid, routing, parseFloat(percent), prevTrends);
                line.textContent = `${displayName}: ${count} (${percent}%)${arrow}`;
                pidBlock.appendChild(line);
            });
            return pidBlock;
        });

        const wrapper = document.createElement('div');
        wrapper.style.display = 'grid';
        wrapper.style.gridTemplateColumns = `repeat(${layoutCols}, 1fr)`;
        wrapper.style.gap = '10px';
        allBlocks.forEach((block, i) => {
            if (i < layoutCols * layoutRows) wrapper.appendChild(block);
        });
        section.appendChild(wrapper);
        saveTrendData(newTrends);
    }

    function waitForTableAndCountRoutings(timeout = 10000) {
        const interval = 500;
        let waited = 0;
        const check = setInterval(() => {
            const rows = document.querySelectorAll('table tbody tr');
            if (rows.length > 0) {
                clearInterval(check);
                console.log('Tabelleninhalt gefunden – PID-Auswertung startet.');
                countRoutingsByPID();
            } else {
                waited += interval;
                if (waited >= timeout) {
                    clearInterval(check);
                    console.warn('Keine Datenzeilen gefunden – PID-Auswertung abgebrochen.');
                }
            }
        }, interval);
    }

    function checkForRequestError(retriesLeft) {
        setTimeout(() => {
            const alerts = Array.from(document.querySelectorAll('.alert.alert-danger.ng-scope'));
            const activeError = alerts.find(div =>
                div.textContent.includes('Error processing request!') && div.offsetParent !== null
            );

            if (activeError) {
                console.warn('Fehler erkannt: Error processing request!');
                if (retriesLeft > 0) {
                    console.log(`Neuer Versuch in 5 Sekunden... (${retriesLeft} verbleibend)`);
                    setTimeout(() => clickSearchButton(retriesLeft - 1), 5000);
                } else {
                    console.error('Maximale Anzahl an Versuchen erreicht. Kein weiterer Retry.');
                }
            } else {
                console.log('Kein sichtbarer Fehler – PID-Auswertung läuft.');
                waitForTableAndCountRoutings();
            }
        }, 2000);
    }

    function clickSearchButton(retries = 3) {
        const tryClick = setInterval(() => {
            const button = document.querySelector('button.btn.btn-success.btn-sm');
            if (button && button.textContent.trim().includes('Search')) {
                button.click();
                clearInterval(tryClick);
                checkForRequestError(retries);
            }
        }, 300);
        setTimeout(() => clearInterval(tryClick), 5000);
    }

        function createUI() {
        if (document.getElementById('sauruman-container')) return;

        const savedRefreshTime = localStorage.getItem('saurumanRefreshTime') || '2';
        const savedRoutingLimit = localStorage.getItem('saurumanRoutingLimit') || '3';
        const savedGroupFlag = localStorage.getItem('saurumanGroupRouting') === 'true';
        const savedFontSize = localStorage.getItem('saurumanFontSize') || '12';
        const savedCols = localStorage.getItem('saurumanLayoutCols') || '1';
        const savedRows = localStorage.getItem('saurumanLayoutRows') || '6';
        const showTrends = localStorage.getItem('saurumanShowTrends') === 'true';

        const container = document.createElement('div');
        container.id = 'sauruman-container';
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.right = '10px';
        container.style.backgroundColor = 'white';
        container.style.border = '2px solid #000';
        container.style.padding = '10px';
        container.style.zIndex = '10000';
        container.style.maxWidth = '400px';
        container.style.fontSize = `${savedFontSize}px`;
        container.style.boxShadow = `0px 0px 10px rgba(0, 0, 0, 0.3)`;
        container.style.cursor = 'move';

        container.innerHTML = `
            <div id="mainControls">
                <label for="refreshTime">Refresher Zeit (Minuten):</label><br>
                <input type="number" id="refreshTime" value="${savedRefreshTime}" style="width: 50px; margin-bottom: 5px;" />
                <button id="startAnalyzing">Start Analyzing</button>
                <button id="stopAnalyzing" style="margin-left:5px; background-color:#b22222; color:white;">Stop</button>
                <button id="toggleSettings" style="float:right; background:none; border:none; cursor:pointer; font-size:16px;">⚙️</button>
                <div id="countdownDisplay" style="margin-top:5px; font-weight:bold; color:#006400;"></div>
                <div id="pidSection" style="margin-top:10px;"></div>
            </div>
            <div id="settingsPanel" style="display:none; margin-top:10px; border:2px solid #ccc; padding:10px; background:#f9f9f9;">
                <h4>Optionen</h4>
                <label for="routingLimit">Top-N Destinations:</label>
                <input type="number" id="routingLimit" value="${savedRoutingLimit}" style="width: 40px;" /><br>
                <label><input type="checkbox" id="groupRoutingCheckbox" ${savedGroupFlag ? 'checked' : ''}/> Gleiche Destinations zusammenlegen</label><br>
                <label><input type="checkbox" id="trendCheckbox" ${showTrends ? 'checked' : ''}/>Trends einblenden</label><br>
                <label for="fontSize">Schriftgröße:</label>
                <input type="range" id="fontSize" min="10" max="24" value="${savedFontSize}" /><span id="fontSizeLabel">${savedFontSize}px</span><br>
                <label for="layoutCols">Spalten x Zeilen:</label>
                <input type="number" id="layoutCols" value="${savedCols}" min="1" max="6" style="width: 40px;" /> x
                <input type="number" id="layoutRows" value="${savedRows}" min="1" max="6" style="width: 40px;" /><br><br>
                <button id="saveSettings">Speichern & Neu Laden</button>
            </div>
        `;

        document.body.appendChild(container);

        const copyright = document.createElement('div');
        copyright.innerHTML = '<a href="https://phonetool.amazon.com/users/BRUNFISC" target="_blank" style="font-size: 10px; color: #666; text-decoration: none;">© brunfisc</a>';
        copyright.style.position = 'absolute';
        copyright.style.top = '6px';
        copyright.style.right = '6px';
        copyright.style.zIndex = '10001';
        container.appendChild(copyright);

        let offsetX, offsetY, isDragging = false;
        container.addEventListener('mousedown', (e) => {
            if (['INPUT', 'BUTTON', 'LABEL'].includes(e.target.tagName)) return;
            isDragging = true;
            offsetX = e.clientX - container.offsetLeft;
            offsetY = e.clientY - container.offsetTop;
        });
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                container.style.left = `${e.clientX - offsetX}px`;
                container.style.top = `${e.clientY - offsetY}px`;
                container.style.right = 'auto';
            }
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        document.getElementById('fontSize').addEventListener('input', (e) => {
            document.getElementById('fontSizeLabel').textContent = `${e.target.value}px`;
            document.getElementById('sauruman-container').style.fontSize = `${e.target.value}px`;
        });

        document.getElementById('saveSettings').addEventListener('click', () => {
            localStorage.setItem('saurumanRoutingLimit', document.getElementById('routingLimit').value);
            localStorage.setItem('saurumanGroupRouting', document.getElementById('groupRoutingCheckbox').checked);
            localStorage.setItem('saurumanFontSize', document.getElementById('fontSize').value);
            localStorage.setItem('saurumanLayoutCols', document.getElementById('layoutCols').value);
            localStorage.setItem('saurumanLayoutRows', document.getElementById('layoutRows').value);
            localStorage.setItem('saurumanShowTrends', document.getElementById('trendCheckbox').checked);
            window.location.reload();
        });

        document.getElementById('toggleSettings').addEventListener('click', () => {
            const panel = document.getElementById('settingsPanel');
            const main = document.getElementById('mainControls');
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            main.style.display = isHidden ? 'none' : 'block';
        });

        document.getElementById('startAnalyzing').addEventListener('click', () => {
            const refreshMinutes = parseInt(document.getElementById('refreshTime').value, 10);
            localStorage.setItem('saurumanRefreshTime', refreshMinutes);
            localStorage.setItem('saurumanAutoShowPID', 'true');
            localStorage.setItem('saurumanAutoStart', 'true');
            localStorage.setItem('saurumanAutoActive', 'true');
            navigateToResearch(refreshMinutes);
        });

        document.getElementById('stopAnalyzing').addEventListener('click', () => {
            localStorage.setItem('saurumanAutoActive', 'false');
            localStorage.removeItem('saurumanAutoShowPID');
            localStorage.removeItem('saurumanTargetHash');
            if (countdownInterval) clearInterval(countdownInterval);
            countdownInterval = null;
            updateCountdownDisplay(0);
        });
    }

    function navigateToResearch(minutes) {
        const timestamp = `relative_time:${minutes}:minutes_ago:0:minutes_ago`;
        const hashParams = `#/container-research?maxResults=5000&orderOldestFirst&searchIncludeStrings=r4&searchIncludeStrings=RC0&serializedTimeRange=${timestamp}`;
        localStorage.setItem('saurumanTargetHash', hashParams);
        window.location.href = window.location.origin + window.location.pathname;
    }

    function updateCountdownDisplay(secondsLeft) {
        const display = document.getElementById('countdownDisplay');
        if (display) {
            const mins = Math.floor(secondsLeft / 60);
            const secs = secondsLeft % 60;
            display.textContent = `Nächster Refresh in: ${mins}:${secs.toString().padStart(2, '0')} Minuten`;
        }
    }

    function onHashChange() {
        const currentHash = location.hash;
        if (currentHash !== lastHash) {
            lastHash = currentHash;
            if (currentHash.includes('#/container-research')) {
                setTimeout(() => {
                    if (localStorage.getItem('saurumanAutoShowPID') === 'true') {
                        document.getElementById('pidSection').style.display = 'block';
                        localStorage.setItem('saurumanAutoShowPID', 'false');
                    }
                    setupAutoReload();
                    clickSearchButton();
                }, 1000);
            }
        }
    }

    function setupAutoReload() {
        if (reloadInterval !== null || countdownInterval !== null) return;
        if (localStorage.getItem('saurumanAutoActive') !== 'true') return;

        const minutes = parseInt(localStorage.getItem('saurumanRefreshTime'), 10);
        if (!isNaN(minutes)) {
            countdownValue = minutes * 60;
            updateCountdownDisplay(countdownValue);
            countdownInterval = setInterval(() => {
                countdownValue--;
                updateCountdownDisplay(countdownValue);
                if (countdownValue <= 0) {
                    localStorage.setItem('saurumanAutoShowPID', 'true');
                    navigateToResearch(minutes);
                    countdownValue = minutes * 60;
                }
            }, 1000);
        }
    }

    createUI();
    lastHash = location.hash;

    const targetHash = localStorage.getItem('saurumanTargetHash');
    if (targetHash) {
        localStorage.removeItem('saurumanTargetHash');
        window.location.href = window.location.origin + window.location.pathname + targetHash;
    }

    setInterval(onHashChange, 1000);

    if (window.location.hash.includes('#/container-research') && localStorage.getItem('saurumanAutoStart') === 'true') {
        localStorage.setItem('saurumanAutoStart', 'false');
        document.getElementById('pidSection').style.display = 'block';
        setupAutoReload();
        clickSearchButton();
    }



  })();










