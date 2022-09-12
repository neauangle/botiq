import {log} from "../logger.js";
import * as util from '../util.js';
import common from '../common.js';
import bigRational from "big-rational";

/*
    Prepend '$' to trigger strings to use fiat in calculations (e.g. on an ETH-BTC tracker, awaiting to '$10%' will wait
    for a 10% rise in the fiat value of eth assuming that can be derived from existing trackers)

*/


//if you make this orEquals then you need to change the test for calculating new price bounds for thenTrigger updates
const TYPE_TO_TEST = {
    'RISE': (a, b) => a.greater(b),
    'FALL': (a, b) => a.lesser(b),
}

const trackerToFunctionKeysMap = new Map();
let functionKeyCounter = 0;
function getFunctionKey(tracker){
    if (!trackerToFunctionKeysMap.has(tracker)){
        trackerToFunctionKeysMap.set(tracker, [])
    }
    trackerToFunctionKeysMap.get(tracker).push(++functionKeyCounter);
    return functionKeyCounter;
}
function checkFunctionKey(tracker, key){
    return trackerToFunctionKeysMap.has(tracker) && trackerToFunctionKeysMap.get(tracker).includes(key);
}
export function stopFunctionsForTracker({tracker}){
    if (!trackerToFunctionKeysMap.has(tracker)){
        trackerToFunctionKeysMap.get(tracker).splice(0);
    }
}



export async function awaitPriceRise({tracker, triggerPriceString, pollIntervalSeconds}){
    return awaitPriceRiseOrFall({type: 'RISE', tracker, triggerPriceString, pollIntervalSeconds});
}

export async function awaitPriceFall({tracker, triggerPriceString, pollIntervalSeconds}){
    return awaitPriceRiseOrFall({type: 'FALL', tracker, triggerPriceString, pollIntervalSeconds});
}

function getTriggerPrice(type, tracker, triggerPriceString){
    let useFiat = false;
    if(triggerPriceString.startsWith('$') || tracker.pair.comparatorIsFiat){
        useFiat = true;
        triggerPriceString = util.trim(triggerPriceString, '$');
    }

    const priceDecimals = useFiat ? common.FIAT_DEFAULT_DECIMALS : tracker.comparator.decimals;
    const s = useFiat ? '$' : '';
    let triggerPrice = {rational: null, string: null};
    if (triggerPriceString.endsWith('%')){
        triggerPriceString = util.trim(triggerPriceString, '%');
        const currentPrice = useFiat ? tracker.mostRecentPrices.fiat : tracker.mostRecentPrices.comparator;
        if (useFiat && currentPrice.rational === null){
            throw Error(`No fiat price for ${tracker.token.symbol} - unable to calculate trigger.`);
        }
        const deltaRational = bigRational(triggerPriceString).divide(100).multiply(currentPrice.rational);
        triggerPrice.rational = currentPrice.rational[type === 'RISE' ? 'add' : 'minus'](deltaRational);
        triggerPrice.string = util.formatRational(triggerPrice.rational, priceDecimals);
        log(`Trigger Price: ${type} to ${triggerPriceString}% of ${s}${currentPrice.string} = ${s}${triggerPrice.string}`);
    } else {
        triggerPrice.rational = bigRational(triggerPriceString);
        triggerPrice.string = triggerPriceString;
        log(`Trigger Price: ${type} to ${s}${triggerPrice.string}`);
    }

    const swapPriceKey = useFiat ? 'averageTokenPriceFiat' :  'averageTokenPriceComparator';
    return {useFiat, swapPriceKey, triggerPrice, priceDecimals};
}


async function awaitPriceRiseOrFall({type, tracker, triggerPriceString, pollIntervalSeconds}){
    const functionKey = getFunctionKey(tracker);
    const {useFiat, swapPriceKey, triggerPrice} = getTriggerPrice(type, tracker, triggerPriceString);
    const s = useFiat ? '$' : '';
    triggerPriceString = undefined; //use triggerPrice.string from here

    return new Promise((resolve, reject) => {
        function listener(details){
            if (!checkFunctionKey(tracker, functionKey)){
                tracker.removeListener({key});
                resolve();
                return;
            }
            const currentPrice = details[swapPriceKey];
            if (currentPrice.rational !== null){
                //console.log(`${s}${currentPrice.string}`);
                if (TYPE_TO_TEST[type](currentPrice.rational, triggerPrice.rational)){
                    tracker.removeListener({key});
                    resolve();
                }
            } else {
                console.log(`Cannot resolve price "${swapPriceKey}" (probably no fiat conversion available)`, currentPrice);
            }
        };
        const addListenerFunc = pollIntervalSeconds ? tracker.addPollingListener : tracker.addSwapListener;
        const key = addListenerFunc({listener, pollIntervalSeconds});
        if (addListenerFunc !== tracker.addPollingListener){//if polling, it gets called straight away anyway
            listener({[swapPriceKey]: useFiat ? tracker.mostRecentPrices.fiat : tracker.mostRecentPrices.comparator});
        }
    });
}

















export async function awaitRiseThenFall({tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds}){
    return awaitRiseThenFallOrFallThenRise({types: ['RISE', 'FALL'], tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds});
}

export async function awaitFallThenRise({tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds}){
    return awaitRiseThenFallOrFallThenRise({types: ['FALL', 'RISE'], tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds});
}



async function awaitRiseThenFallOrFallThenRise({types, tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds}){
    const functionKey = getFunctionKey(tracker);
    if (!tracker.pair.comparatorIsFiat && (firstTriggerString.startsWith('$') !== thenTriggerString.startsWith('$'))){
        throw Error("firstTriggerString and thenTriggerString must agree on whether to use fiat or not");
    }
    if (!thenTriggerString.endsWith('%')){
        throw Error('thenTriggerString must be a percentage');
    }
    const {useFiat, swapPriceKey, triggerPrice, priceDecimals} = getTriggerPrice(types[0], tracker, firstTriggerString);
    const s = useFiat ? '$' : '';
    firstTriggerString = undefined; //use triggerPrice.string from here
    thenTriggerString = util.trim(thenTriggerString, '$');
    thenTriggerString = util.trim(thenTriggerString, '%');
    const thenFractionRational = bigRational(thenTriggerString).divide(100);
    const priceOnActivation = useFiat ? tracker.mostRecentPrices.fiat : tracker.mostRecentPrices.comparator;
    
    let hasHitInitialTrigger = false;
    let mostExtremePriceAfterInitialTrigger;
    let thenTriggerPriceRational;

    return new Promise((resolve, reject) => {
        let key;
        function listener(details){
            if (!checkFunctionKey(tracker, functionKey)){
                tracker.removeListener({key});
                resolve();
                return;
            }

            const currentPrice = details[swapPriceKey];
            //console.log(`${s}${currentPrice.string}`);
            if (!hasHitInitialTrigger){
                if (currentPrice.rational !== null && TYPE_TO_TEST[types[0]](currentPrice.rational, triggerPrice.rational)){
                    log(`Initial trigger met at ${s}${currentPrice.string}`);
                    hasHitInitialTrigger = true;
                }
            }

            if (hasHitInitialTrigger){
                if (!mostExtremePriceAfterInitialTrigger || TYPE_TO_TEST[types[0]](currentPrice.rational, mostExtremePriceAfterInitialTrigger.rational)){
                    //log(`Price ${types[0]} to new bounds: ${s}${util.formatRational(currentPrice.rational, priceDecimals)}`);
                    mostExtremePriceAfterInitialTrigger = currentPrice;
                    //add to lowerbounds to get the trigger price to hit on our way up, and vice versa
                    //RISE is lowerbounds because we're on our way back up from extreme lowerbounds to that lowerbounds + offset
                    if (usingPercentOfDelta){
                        let delta;
                        if (types[1] === 'RISE'){
                            delta = mostExtremePriceAfterInitialTrigger.rational.minus(priceOnActivation.rational).abs();
                            thenTriggerPriceRational = mostExtremePriceAfterInitialTrigger.rational.add(delta.multiply(thenFractionRational));
                        } else {
                            delta = mostExtremePriceAfterInitialTrigger.rational.minus(priceOnActivation.rational).abs();
                            thenTriggerPriceRational = mostExtremePriceAfterInitialTrigger.rational.minus(delta.multiply(thenFractionRational));
                        }
                        //log(`Then trigger: ${types[1]} ${thenTriggerString}% of delta ${s}${util.formatRational(delta, priceDecimals)} to ${s}${util.formatRational(thenTriggerPriceRational, priceDecimals)}`);
                    } else {
                        if (types[1] === 'RISE'){
                            thenTriggerPriceRational = mostExtremePriceAfterInitialTrigger.rational.add(mostExtremePriceAfterInitialTrigger.rational.multiply(thenFractionRational));
                        } else {
                            thenTriggerPriceRational = mostExtremePriceAfterInitialTrigger.rational.minus(mostExtremePriceAfterInitialTrigger.rational.multiply(thenFractionRational));
                        }
                        //log(`Then trigger: ${types[1]} to ${thenTriggerString}% of ${s}${mostExtremePriceAfterInitialTrigger.string} = ${s}${util.formatRational(thenTriggerPriceRational, priceDecimals)}`);
                    }
                }
    
                if (TYPE_TO_TEST[types[1]](currentPrice.rational, thenTriggerPriceRational)){
                    log(`Then trigger met at ${s}${currentPrice.string}`);
                    //I'm unsure on this. Might be better to have usingPercentOfDelta test against initialTrigger too, or use acivationPice?
                    const testJumpbackAgainst = usingPercentOfDelta ? 'activation price' : 'initial trigger';
                    const testJumpbackPrice = testJumpbackAgainst === 'activation price' ? priceOnActivation : triggerPrice;//1st trigger
                    
                    if (TYPE_TO_TEST[types[1]](currentPrice.rational, testJumpbackPrice.rational)){
                        log(`Price ${s}${types[1]} back past ${s}${testJumpbackAgainst}! Resetting...`);
                        //we reset the second-stage trigger but keep the iniital trigger as is (ie if it was given as a percentage
                        //we don't recalculate using the current price)
                        hasHitInitialTrigger = false;
                        listener(details);
                        return; 
                    } else {
                        tracker.removeListener({key});
                        resolve();
                    } 
                } 
            }
        }    
        const addListenerFunc = pollIntervalSeconds ? tracker.addPollingListener : tracker.addSwapListener;
        key = addListenerFunc({listener, pollIntervalSeconds});
        if (addListenerFunc !== tracker.addPollingListener){//if polling, it gets called straight away anyway
            listener({[swapPriceKey]: useFiat ? tracker.mostRecentPrices.fiat : tracker.mostRecentPrices.comparator});
        }
    });
}




export async function awaitFallThenRiseWithUpshift({tracker, upshiftPercentage, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds}){
    const functionKey = getFunctionKey(tracker);
    let fallThenRiseTriggered = false;
    while (!fallThenRiseTriggered){
        if (!checkFunctionKey(tracker, functionKey)){
            return;
        }
        await Promise.race([
            awaitPriceRise({tracker, triggerPriceString: upshiftPercentage, pollIntervalSeconds}),
            async () => {
                awaitFallThenRise({tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds});
                fallThenRiseTriggered = true;
            } 
        ]);
        if (!fallThenRiseTriggered){
            log(`Upshift triggered, resetting...`);
        }
    }
}

export async function awaitRiseThenFallWithDownshift({tracker, downshiftPercentage, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds}){
    const functionKey = getFunctionKey(tracker);
    let riseThenFallTriggered = false;
    while (!riseThenFallTriggered){
        if (!checkFunctionKey(tracker, functionKey)){
            return;
        }
        await Promise.race([
            awaitPriceFall({tracker, triggerPriceString: downshiftPercentage, pollIntervalSeconds}),
            async () => {
                awaitRiseThenFall({tracker, firstTriggerString, thenTriggerString, usingPercentOfDelta, pollIntervalSeconds});
                riseThenFallTriggered = true;
            } 
        ]);
        if (!riseThenFallTriggered){
            log(`Downshift triggered, resetting...`);
        }
    }
}