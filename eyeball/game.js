'use strict';

const ROUNDS = 5;
const SLOPE_ZERO_DEG = 15;      // slope error (degrees on screen) that scores zero
const INTERCEPT_ZERO_FRAC = 0.1; // intercept error, as a fraction of the plotted y range
const R2_ZERO = 0.2;            // absolute R² error that scores zero
const START_TOLERANCE = 0.05; // random extra offset of the first point, as a fraction
const MAX_POINTS = 300;

// Each level returns the x values for one round, the target R² range (or a fixed noise) and
// the powers of ten the slope magnitude can take.
const LEVELS = {
    easy: {
        help: '8 points, 1 apart, starting 5–10 % of the way along the x axis. Little scatter.',
        xs: () => shift(grid(8, 1), startAt(0.05, 7)),
        r2: [0.85, 0.99],
        scales: [0]
    },
    medium: {
        help: '20 points, 0.5 apart, starting 15–20 % of the way along the x axis. '
            + 'Moderate scatter.',
        xs: () => shift(grid(20, 0.5), startAt(0.15, 9.5)),
        r2: [0.5, 0.95],
        scales: [0, 1]
    },
    hard: {
        help: '40 points at random x, starting 25–30 % of the way along the x axis. '
            + 'Anything from tidy to a cloud.',
        xs: () => {
            const width = uniform(5, 15);
            const start = startAt(0.25, width);
            const inner = Array.from({ length: 38 }, () => uniform(start, start + width));
            return [start, ...inner.sort((a, b) => a - b), start + width];
        },
        r2: [0.1, 0.95],
        scales: [-1, 0, 1, 2]
    },
    custom: {
        help: 'Choose where the data start, how wide they spread, the x spacing and the noise.',
        xs: null, // set from the form
        r2: null,
        scales: [-1, 0, 1, 2]
    }
};

const QUANTITIES = {
    slope: { name: 'slope', prompt: 'Your estimate of the slope:' },
    intercept: { name: 'y-intercept', prompt: 'Your estimate of the y-intercept (y at x = 0):' },
    r2: { name: 'R²', prompt: 'Your estimate of R² (0 to 1):' }
};

const $ = (id) => document.getElementById(id);
const canvas = $('plot');
const ctx = canvas.getContext('2d');

const state = {
    quantity: 'slope',
    levelKey: 'easy',
    level: null,
    roundIndex: 0,
    round: null,
    revealed: false,
    results: [],
    geom: null
};

// ---------- maths ----------

function uniform(a, b) {
    return a + (b - a) * Math.random();
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function gauss() {
    // Box–Muller
    let u = 0;
    while (u === 0) {
        u = Math.random();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function grid(n, step) {
    return Array.from({ length: n }, (_, i) => i * step);
}

function shift(xs, start) {
    return xs.map((x) => x + start);
}

// x of the first point, so that on an axis from 0 to the last point it sits a random fraction
// between f and f + START_TOLERANCE of the way along. width is the span of the data.
function startAt(f, width) {
    const s = uniform(f, f + START_TOLERANCE);
    return (width * s) / (1 - s);
}

function mean(v) {
    return v.reduce((s, a) => s + a, 0) / v.length;
}

function ols(xs, ys) {
    const mx = mean(xs);
    const my = mean(ys);
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }
    const slope = sxy / sxx;
    return {
        slope,
        intercept: my - slope * mx,
        r2: syy > 0 ? Math.min(1, (sxy * sxy) / (sxx * syy)) : 1
    };
}

function makeRound(level) {
    const xs = level.xs();
    const xMin = xs[0];
    const xMax = xs[xs.length - 1];
    const xSpan = xMax - xMin;

    const m = (Math.random() < 0.5 ? -1 : 1) * uniform(0.2, 5) * 10 ** pick(level.scales);
    const b = uniform(-1, 1) * Math.abs(m) * xSpan;

    let sigma;
    if (level.noisePct !== undefined) {
        sigma = (level.noisePct / 100) * Math.abs(m) * xSpan;
    } else {
        // For a line with noise sigma, R² ≈ var(m x) / (var(m x) + sigma²)
        const target = uniform(level.r2[0], level.r2[1]);
        const mx = mean(xs);
        const sdx = Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)));
        sigma = Math.abs(m) * sdx * Math.sqrt((1 - target) / target);
    }

    const ys = xs.map((x) => m * x + b + sigma * gauss());
    const fit = ols(xs, ys);

    // Axis ranges in data units; x = 0 is shown unless the data are further from it than
    // their own span.
    const showZero = xMin <= xSpan && xMax >= -xSpan;
    const lo = showZero ? Math.min(0, xMin) : xMin;
    const hi = showZero ? Math.max(0, xMax) : xMax;
    const xPad = 0.04 * (hi - lo);
    const xr = [lo - xPad, hi + xPad];
    const lineY = xr.map((x) => fit.slope * x + fit.intercept);
    let yLo = Math.min(...ys, ...lineY);
    let yHi = Math.max(...ys, ...lineY);
    const yPad = 0.08 * (yHi - yLo || 1);
    yLo -= yPad;
    yHi += yPad;

    return { xs, ys, fit, xr, yr: [yLo, yHi] };
}

// ---------- formatting ----------

function fmt(v) {
    if (!Number.isFinite(v)) {
        return '—';
    }
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) {
        return v.toExponential(2);
    }
    return String(Number(v.toPrecision(3)));
}

function niceStep(span, maxTicks) {
    const raw = span / maxTicks;
    const p = 10 ** Math.floor(Math.log10(raw));
    for (const f of [1, 2, 5, 10]) {
        if (f * p >= raw) {
            return f * p;
        }
    }
    return 10 * p;
}

function ticks(lo, hi, maxTicks) {
    const step = niceStep(hi - lo, maxTicks);
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const out = [];
    for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9 * step; k++) {
        const v = Math.abs(k) < 1e-12 ? 0 : k * step;
        out.push({ v, label: v.toFixed(decimals) });
    }
    return out;
}

function parseNumber(text) {
    const t = text.trim().replace(',', '.').replace('−', '-');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) {
        return NaN;
    }
    return Number(t);
}

// ---------- drawing ----------

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function draw() {
    const r = state.round;
    if (!r) {
        return;
    }
    const w = canvas.clientWidth;
    const h = Math.round(Math.min(460, Math.max(240, w * 0.62)));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const muted = cssVar('--text-muted');
    const border = cssVar('--border');
    const accent = cssVar('--accent');
    const font = '12px ' + getComputedStyle(document.body).fontFamily;
    ctx.font = font;

    const xt = ticks(r.xr[0], r.xr[1], w < 500 ? 6 : 10);
    const yt = ticks(r.yr[0], r.yr[1], 6);
    const labelW = Math.max(...yt.map((t) => ctx.measureText(t.label).width));
    const left = Math.ceil(labelW) + 14;
    const right = 14;
    const top = 12;
    const bottom = 30;
    const pw = w - left - right;
    const ph = h - top - bottom;

    const sx = pw / (r.xr[1] - r.xr[0]);
    const sy = ph / (r.yr[1] - r.yr[0]);
    const X = (x) => left + (x - r.xr[0]) * sx;
    const Y = (y) => top + ph - (y - r.yr[0]) * sy;
    state.geom = { pxPerX: sx, pxPerY: sy };

    // Grid and tick labels
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.strokeStyle = border;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xt) {
        const px = Math.round(X(t.v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, top + ph);
        ctx.stroke();
        ctx.fillText(t.label, px, top + ph + 8);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yt) {
        const py = Math.round(Y(t.v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, py);
        ctx.lineTo(left + pw, py);
        ctx.stroke();
        ctx.fillText(t.label, left - 8, py);
    }

    // Axes through zero, when visible
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5;
    if (r.xr[0] <= 0 && r.xr[1] >= 0) {
        ctx.beginPath();
        ctx.moveTo(X(0), top);
        ctx.lineTo(X(0), top + ph);
        ctx.stroke();
    }
    if (r.yr[0] <= 0 && r.yr[1] >= 0) {
        ctx.beginPath();
        ctx.moveTo(left, Y(0));
        ctx.lineTo(left + pw, Y(0));
        ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, pw, ph);
    ctx.clip();

    const lineAt = (x) => r.fit.slope * x + r.fit.intercept;

    // Residuals, shown after an R² guess
    if (state.revealed && state.quantity === 'r2') {
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
        ctx.lineWidth = 1;
        for (let i = 0; i < r.xs.length; i++) {
            ctx.beginPath();
            ctx.moveTo(X(r.xs[i]), Y(r.ys[i]));
            ctx.lineTo(X(r.xs[i]), Y(lineAt(r.xs[i])));
            ctx.stroke();
        }
    }

    // Points
    const radius = r.xs.length > 100 ? 2.5 : 3.5;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
    for (let i = 0; i < r.xs.length; i++) {
        ctx.beginPath();
        ctx.arc(X(r.xs[i]), Y(r.ys[i]), radius, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Fitted line and, for the intercept, the point at x = 0
    if (state.revealed) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X(r.xr[0]), Y(lineAt(r.xr[0])));
        ctx.lineTo(X(r.xr[1]), Y(lineAt(r.xr[1])));
        ctx.stroke();
        if (state.quantity === 'intercept' && r.xr[0] <= 0) {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(X(0), Y(r.fit.intercept), 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
    ctx.restore();
}

// ---------- scoring ----------

function slopeAngle(m) {
    return (Math.atan((m * state.geom.pxPerY) / state.geom.pxPerX) * 180) / Math.PI;
}

function score(guess) {
    const r = state.round;
    let err;
    let errText;
    let frac;
    if (state.quantity === 'slope') {
        err = Math.abs(slopeAngle(guess) - slopeAngle(r.fit.slope));
        frac = err / SLOPE_ZERO_DEG;
        errText = err.toFixed(1) + '°';
    } else if (state.quantity === 'intercept') {
        err = Math.abs(guess - r.fit.intercept);
        frac = err / (INTERCEPT_ZERO_FRAC * (r.yr[1] - r.yr[0]));
        errText = fmt(err);
    } else {
        err = Math.abs(guess - r.fit.r2);
        frac = err / R2_ZERO;
        errText = err.toFixed(2);
    }
    return { points: Math.round(100 * Math.max(0, 1 - frac)), errText };
}

function trueValue() {
    const f = state.round.fit;
    return state.quantity === 'slope' ? f.slope : state.quantity === 'intercept'
        ? f.intercept : f.r2;
}

// ---------- flow ----------

function totalScore() {
    return state.results.reduce((s, r) => s + r.points, 0);
}

function show(id) {
    for (const s of ['setup', 'game', 'end']) {
        $(s).hidden = s !== id;
    }
}

function readSetup() {
    const form = $('setup-form');
    state.quantity = form.elements.quantity.value;
    state.levelKey = form.elements.level.value;
    const base = LEVELS[state.levelKey];
    if (state.levelKey !== 'custom') {
        state.level = base;
        return null;
    }
    const xMin = parseNumber($('xmin').value);
    if (!Number.isFinite(xMin)) {
        return 'Smallest x must be a number.';
    }
    const width = parseNumber($('width').value);
    if (!(width > 0)) {
        return 'Width must be a number greater than 0.';
    }
    const dx = parseNumber($('dx').value);
    // Smallest step giving at most MAX_POINTS points, rounded up to 2 significant figures
    const raw = width / (MAX_POINTS - 1);
    const p = 10 ** (Math.floor(Math.log10(raw)) - 1);
    const minDx = Number((Math.ceil(raw / p) * p).toPrecision(2));
    if (!(dx >= minDx && dx <= width / 2)) {
        return `Δx must be a number between ${fmt(minDx)} and ${fmt(width / 2)}.`;
    }
    const n = Math.floor(width / dx + 1e-9) + 1;
    state.level = {
        ...base,
        xs: () => shift(grid(n, dx), xMin + uniform(0, START_TOLERANCE) * width),
        noisePct: Number($('noise').value)
    };
    return null;
}

function startGame() {
    const error = readSetup();
    $('setup-error').textContent = error || '';
    if (error) {
        return;
    }
    state.roundIndex = 0;
    state.results = [];
    show('game');
    nextRound();
}

function nextRound() {
    if (state.roundIndex >= ROUNDS) {
        endGame();
        return;
    }
    state.round = makeRound(state.level);
    state.revealed = false;
    state.roundIndex++;
    $('round-label').textContent = `Round ${state.roundIndex} / ${ROUNDS}`;
    $('score-label').textContent = `Score ${totalScore()}`;
    $('guess-label').textContent = QUANTITIES[state.quantity].prompt;
    $('guess').value = '';
    $('guess').disabled = false;
    $('guess-button').textContent = 'Guess';
    $('feedback').textContent = '';
    draw();
    $('guess').focus();
}

function submitGuess() {
    if (state.revealed) {
        nextRound();
        return;
    }
    const guess = parseNumber($('guess').value);
    const fb = $('feedback');
    if (!Number.isFinite(guess)) {
        fb.innerHTML = '<span class="bad">Please type a number, e.g. 2.5 or -0.3.</span>';
        return;
    }
    if (state.quantity === 'r2' && (guess < 0 || guess > 1)) {
        fb.innerHTML = '<span class="bad">R² is between 0 and 1.</span>';
        return;
    }

    const { points, errText } = score(guess);
    const truth = trueValue();
    state.results.push({ truth, guess, errText, points });
    state.revealed = true;
    draw();

    const name = QUANTITIES[state.quantity].name;
    const cls = points >= 50 ? 'good' : 'bad';
    fb.innerHTML = `Fitted ${name}: <strong>${fmt(truth)}</strong> · your guess: ${fmt(guess)}` +
        ` · off by ${errText}<br><span class="${cls}">+${points} points</span>`;
    $('score-label').textContent = `Score ${totalScore()}`;
    $('guess').disabled = true;
    $('guess-button').textContent = state.roundIndex >= ROUNDS ? 'See results' : 'Next';
    $('guess-button').focus();
}

function bestKey() {
    return `eyeball.best.${state.quantity}.${state.levelKey}`;
}

function endGame() {
    const total = totalScore();
    $('final-score').textContent = `${total} / ${ROUNDS * 100} points`;

    let best = null;
    try {
        best = Number(localStorage.getItem(bestKey())) || null;
        if (best === null || total > best) {
            localStorage.setItem(bestKey(), String(total));
        }
    } catch (e) {
        best = undefined; // storage unavailable: just don't show a best score
    }
    const label = `${QUANTITIES[state.quantity].name}, ${state.levelKey}`;
    $('best-score').textContent = best === undefined ? ''
        : best === null || total > best ? `New best for ${label}!`
        : `Your best for ${label}: ${best}`;

    const body = $('summary').querySelector('tbody');
    body.innerHTML = '';
    state.results.forEach((r, i) => {
        const tr = document.createElement('tr');
        for (const v of [i + 1, fmt(r.truth), fmt(r.guess), r.errText, r.points]) {
            const td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
        }
        body.appendChild(tr);
    });
    state.round = null;
    show('end');
}

function updateSetupUi() {
    const level = $('setup-form').elements.level.value;
    $('level-help').textContent = LEVELS[level].help;
    $('custom-options').hidden = level !== 'custom';
    $('noise-value').textContent = `(${$('noise').value} %)`;
}

// ---------- wiring ----------

$('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startGame();
});
$('setup-form').addEventListener('input', updateSetupUi);
$('guess-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitGuess();
});
$('quit').addEventListener('click', () => {
    state.round = null;
    show('setup');
});
$('again').addEventListener('click', startGame);
$('change').addEventListener('click', () => show('setup'));
window.addEventListener('resize', draw);

updateSetupUi();

// Exposed for checking the maths from the browser console.
window.eyeball = { ols, makeRound, LEVELS, state };
