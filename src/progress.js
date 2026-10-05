let progressTimeout = null;
let progressInterval = null;
let progressValue = 0;

function getProgressBar() {
    let el = document.getElementById('fireline-progress');
    if (!el) {
        el = document.createElement('div');
        el.id = 'fireline-progress';
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = '0%';
        el.style.height = '3px';
        el.style.backgroundColor = window.FireLine?.settings.progressColor || '#29d';
        el.style.transition = 'width 200ms ease-out, opacity 200ms ease-out';
        el.style.zIndex = '999999';
        el.style.pointerEvents = 'none';
        document.body.appendChild(el);
    }
    return el;
}

export function startProgress() {
    if (!window.FireLine?.settings.progressBar) return;
    const el = getProgressBar();
    el.style.backgroundColor = window.FireLine?.settings.progressColor || '#29d';
    el.style.opacity = '1';
    el.style.width = '5%';
    progressValue = 5;
    
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (progressValue >= 90) {
            clearInterval(progressInterval);
            return;
        }
        progressValue += Math.random() * 5;
        el.style.width = `${progressValue}%`;
    }, 200);
}

export function stopProgress() {
    if (!window.FireLine?.settings.progressBar) return;
    const el = getProgressBar();
    clearInterval(progressInterval);
    progressValue = 100;
    el.style.width = '100%';
    
    clearTimeout(progressTimeout);
    progressTimeout = setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => { el.style.width = '0%'; }, 200);
    }, 300);
}
