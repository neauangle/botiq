import * as util from '../util.js';

export const SECOND_MS = 1000;
export const MINUTE_MS = SECOND_MS * 60;
export const HOUR_MS = MINUTE_MS * 60;
export const DAY_MS = HOUR_MS * 24;
export const WEEK_MS = DAY_MS * 7;

const keyToAwait = {};


export function cancelInterval({key}){
    keyToAwait[key].cancelled = true;
    cancelTimeout({key: keyToAwait[key].timeoutKey});
}

export function setPreciseInterval({callback, intervalMS}){
    const key = util.getUniqueId();
    keyToAwait[key] = {timeoutKey: null, cancelled:false};
    (async () => {
        while (true){
            await new Promise((resolve, reject) =>  {
                keyToAwait[key].timeoutKey = setPreciseTimeout({callback: resolve, lengthMs: intervalMS, callCallbackOnCancel: true});
            });
            if (!keyToAwait[key].cancelled){
                callback();
            }
            if (keyToAwait[key].cancelled){
                delete keyToAwait[key];
                break;
            }
        }
    })();
    return key;
}


export function cancelTimeout({key}){
    delete keyToAwait[key];
}

export function setPreciseTimeout({callback, lengthMs, callbackOnCancel}){
    const key = util.getUniqueId();
    keyToAwait[key] = true;

    const intervalMs = 100;
    const thresholdMs = 10;

    const startMs = Date.now();

    const internalCallback = () => {
        if (!keyToAwait[key]){
            if (callbackOnCancel){
                callback();
            }
            return;
        }
        const currentMS =  Date.now();
        const elapsedMS = currentMS - startMs;
        const msToGo = lengthMs - elapsedMS;
        if (msToGo < thresholdMs){
            delete keyToAwait[key];
            callback();
        } else {
            setTimeout(internalCallback, Math.min(intervalMs, msToGo));
        }
    };
    setTimeout(internalCallback, Math.min(intervalMs, lengthMs));

    return key;
}



export async function awaitImpreciseMs(ms) {
    return new Promise(function (resolve, reject) {
        setTimeout(resolve, ms)
    })
}