import * as util from '../util.js';
import EventEmitter from 'events';
import bigRational from "big-rational";

//This module is experimental- mfi is bugged out and it might be because of volume or something calculated here

const DURATION_KEY_TO_DURATION_MS = {
    '1m':  1000 * 60 * 1,
    '15m': 1000 * 60 * 15,
    '30m': 1000 * 60 * 30,
    '1h':  1000 * 60 * 60,
    '4h':  1000 * 60 * 60 * 4,
    '1d':  1000 * 60 * 60 * 24,
    '1w':  1000 * 60 * 60 * 24 * 7,
}
function roundMSDownToDuration(durationKey, ms){
    return Math.floor(ms / DURATION_KEY_TO_DURATION_MS[durationKey]) * DURATION_KEY_TO_DURATION_MS[durationKey]
}
function roundMSUpToDuration(durationKey, ms){
    return Math.ceil(ms / DURATION_KEY_TO_DURATION_MS[durationKey]) * DURATION_KEY_TO_DURATION_MS[durationKey];
}


function getNewBar(timestamp, initialPriceString){
   return {
        open: initialPriceString,
        high: initialPriceString,
        low: initialPriceString,
        close: initialPriceString,
        timestamp,
        volume: {
            token: '0',
            comparator: '0'
        }, 
        completed: false
    }
}

//note that trades that come in before the current minute are ignored
//it is assumed that historic minute klines ae complete
//therefore any trades that stream in with a timestamp of or before the last minute kline's will be ignored.
export function createBarManager({tracker, durationKeys, historicMinuteKlines}){
    const durationKeyToBars = {};
    if (!durationKeys){
        durationKeys = Object.keys(DURATION_KEY_TO_DURATION_MS);
    }
    durationKeys.forEach(durationKey => {
        if (!DURATION_KEY_TO_DURATION_MS[durationKey]){
            throw Error(`Invalid duration key "${durationKey}". Valid keys: ${Object.keys(DURATION_KEY_TO_DURATION_MS)}")`);
        }
        durationKeyToBars[durationKey] = [];
    });
    let listenKey;
    let msAtstart;
    let currentMinuteMs;
    //let msAtNextMinute;

    const keyToBarListenerRegistration = {};

    const eventEmitter = new EventEmitter();
    const barManager = {
        durationKeyToBars,
        addPriceListener: ({listener}) => eventEmitter.addListener('newprice', listener),
        removePriceListener: ({listener}) => eventEmitter.removeListener('newprice', listener),

        addBarUpdatedListener: ({listener}) => eventEmitter.addListener('newprice', listener),
        removePriceListener: ({listener}) => eventEmitter.removeListener('newprice', listener),
        
        addNewBarListener: ({durationKey, listener}) => {
            const key = util.getUniqueId();
            eventEmitter.addListener('barcompleted-'+durationKey, listener)
            keyToBarListenerRegistration[key] = {durationKey, listener};
            return key;
        },
        removeNewBarListener: ({key}) => {
            if (keyToBarListenerRegistration[key]){
                const registration = keyToBarListenerRegistration[key];
                eventEmitter.removeListener('barcompleted-'+ registration.durationKey, registration.internalListener);
                delete keyToBarListenerRegistration[key];
            } 
        },
        getCurrentBar: (durationKey) => {
            const bars = durationKeyToBars[durationKey];
            return bars[bars.length-1];
        },
        
        disconnect: () => {
            tracker.removeListener({key: listenKey});
        }
    }
    
    if (historicMinuteKlines && historicMinuteKlines.length){
        msAtstart = historicMinuteKlines[0].timestamp;
        currentMinuteMs = historicMinuteKlines[historicMinuteKlines.length-1].timestamp;
        for (let i = 0; i  < historicMinuteKlines.length; ++i){
            const historicMinuteKline = historicMinuteKlines[i];

            //deals with gaps in klines (e.g. kucoin "No data is published for intervals where there are no ticks.")
            let timestamp;
            if (i === 0){
                timestamp = historicMinuteKline.timestamp;
            } else {
                timestamp = historicMinuteKlines[i-1].timestamp + 60 * 1000;
            }
            while (timestamp !== historicMinuteKline.timestamp){
                for (const durationKey of durationKeys){
                    const bars = barManager.durationKeyToBars[durationKey];
                    if (timestamp % DURATION_KEY_TO_DURATION_MS[durationKey] === 0){
                        bars[bars.length-1].completed = true;
                        bars.push(getNewBar(timestamp,  bars[bars.length-1].close));
                    }
                }
                timestamp += 60 * 1000;
            }

            for (const durationKey of durationKeys){
                const bars = barManager.durationKeyToBars[durationKey];
                if (!bars.length || historicMinuteKline.timestamp % DURATION_KEY_TO_DURATION_MS[durationKey] === 0){
                    const lastBar = bars[bars.length-1];
                    bars.push(getNewBar(historicMinuteKline.timestamp, lastBar ? lastBar.close : historicMinuteKline.open));
                    if (lastBar){
                        lastBar.completed = true;
                    }
                }
                const currentBar = bars[bars.length-1];
                currentBar.close = historicMinuteKline.close;
                if (bigRational(historicMinuteKline.high).greater(currentBar.high)){
                    currentBar.high = historicMinuteKline.high;
                }  
                if (bigRational(historicMinuteKline.low).lesser(currentBar.low)){
                    currentBar.low = historicMinuteKline.low;
                } 
                currentBar.volume.token = util.formatRational(bigRational(historicMinuteKline.volume.token).add(currentBar.volume.token), tracker.token.decimals);
                currentBar.volume.comparator = util.formatRational(bigRational(historicMinuteKline.volume.comparator).add(currentBar.volume.comparator), tracker.comparator.decimals);
            }
        }
        
        console.log(`${new Date(currentMinuteMs).toUTCString()}`, `${new Date(roundMSDownToDuration('1m', Date.now())).toUTCString()}`);
        while (currentMinuteMs < roundMSDownToDuration('1m', Date.now())){
            currentMinuteMs += 60*1000;
            console.log('added', `${new Date(currentMinuteMs).toUTCString()}`, `${new Date(roundMSDownToDuration('1m', Date.now())).toUTCString()}`);
            for (const durationKey of durationKeys){
                if (currentMinuteMs % DURATION_KEY_TO_DURATION_MS[durationKey] === 0){
                    const bars = barManager.durationKeyToBars[durationKey];
                    const lastBar = bars[bars.length-1];
                    lastBar.completed = true;
                    bars.push(getNewBar(currentMinuteMs, lastBar.close));
                }
            }
        }

    } else {
        msAtstart = roundMSDownToDuration('1m', tracker.mostRecentPrices.timestamp);
        currentMinuteMs = msAtstart;//roundMSUpToDuration('1m', msAtstart+1);
        durationKeys.forEach(durationKey => {
            barManager.durationKeyToBars[durationKey].push(getNewBar(currentMinuteMs, tracker.mostRecentPrices.comparator.string)); 
        });
    }

    let msAtNextMinute = currentMinuteMs + 60*1000;

    listenKey = tracker.addSwapListener({listener: (swapDetails) => {
        //console.log('here', tracker.mostRecentPrices)
        //console.log(swapDetails.timestamp - currentMinuteMs, swapDetails.timestamp, currentMinuteMs)
        if (swapDetails.timestamp < currentMinuteMs){
            console.log('skipped late swap', `${new Date(swapDetails.timestamp).toUTCString()}`,`${new Date(currentMinuteMs).toUTCString()}` );
            return;
        }
        //console.log(swapDetails.timestamp - msAtNextMinute, swapDetails.timestamp, msAtNextMinute);
        let durationKeysUpdated;
        while (swapDetails.timestamp >= msAtNextMinute){
            for (const durationKey of durationKeys){
                if (msAtNextMinute % DURATION_KEY_TO_DURATION_MS[durationKey] === 0){
                    //console.log('new bar', durationKey, `${new Date(currentMinuteMs).toUTCString()}`);
                    if (!durationKeysUpdated){
                        durationKeysUpdated = [];
                    }
                    durationKeysUpdated.push(durationKey);
                    const bars = durationKeyToBars[durationKey];
                    const lastBar = bars[bars.length-1];
                    lastBar.completed = true;
                    bars.push(getNewBar(msAtNextMinute, lastBar.close));
                }
            }
            currentMinuteMs = msAtNextMinute;
            msAtNextMinute += 60 * 1000;
        }

        if (durationKeysUpdated){
            const durationKeyToCompletedBar = {};
            for (const durationKey of durationKeysUpdated){
                if (durationKeyToBars[durationKey].length >= 2){ //ie one has closed and another has just been added
                    durationKeyToCompletedBar[durationKey] = durationKeyToBars[durationKey][durationKeyToBars[durationKey].length-2];
                    eventEmitter.emit('barcompleted-'+durationKey, {bar: durationKeyToCompletedBar[durationKey]});
                }
            }
            //eventEmitter.emit('barcompleted', {durationKeysUpdated, durationKeyToCompletedBar, durationKeyToBars});
        }

        //console.log('adding trade', `${new Date(swapDetails.timestamp).toUTCString()}`);
        for (const durationKey of durationKeys){
            const bars = durationKeyToBars[durationKey];
            const currentBar = bars[bars.length-1];
            currentBar.close = swapDetails.averageTokenPriceComparator.string;
            if (swapDetails.averageTokenPriceComparator.rational.greater(currentBar.high)){
                currentBar.high = swapDetails.averageTokenPriceComparator.string;
            }
            if (swapDetails.averageTokenPriceComparator.rational.lesser(currentBar.low)){
                currentBar.low = swapDetails.averageTokenPriceComparator.string;
            }
            currentBar.volume.token = util.formatRational(swapDetails.tokenQuantity.rational.add(currentBar.volume.token), tracker.token.decimals);
            currentBar.volume.comparator = util.formatRational(swapDetails.comparatorQuantity.rational.add(currentBar.volume.comparator), tracker.comparator.decimals);
        }
        eventEmitter.emit('newprice', tracker.mostRecentPrices);
        
    }});

    return barManager;
}