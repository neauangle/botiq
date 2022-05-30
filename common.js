import EventEmitter from 'events';
import bigRational from "big-rational";
import * as util from './util.js';
import {log} from "./logger.js";

const FIAT_DEFAULT_DECIMALS = 8;

const TRACKER_DATA_EVENTS = {
    PRICE_UPDATE: "PRICE_UPDATE",
    USER_LISTENER_CONNECTED: "USER_LISTENER_CONNECTED",
    TEST_STREAM_STATUS_UPDATED: "TEST_STREAM_STATUS_UPDATED",
    SWAP: "SWAP"
}

const TEST_STREAM_STATUS = {
    RUNNING: "RUNNING",
    ENDED: "ENDED",
    PAUSED: "PAUSED"
}


function getTrackerLinkToFiat(tracker){
    const link = _getTrackerLinkToFiat(tracker, []);
    if (link){
        link.reverse();
    }
    return link;
}

function _getTrackerLinkToFiat(tracker, link){
    if (tracker.pair.comparatorIsFiat){
        link.push(tracker);
        return link;
    }
    let uplinkTrackers = trackerDatabase[tracker.id].getUplinkTrackers(tracker);
    for (const uplinkTracker of uplinkTrackers){
        let successfulLink = _getTrackerLinkToFiat(uplinkTracker, link);
        if (successfulLink){
            successfulLink.push(uplinkTracker);
            return successfulLink;
        }
    }
    return null;
}


async function getFiatQuantityRational({tracker, priceRational, priceIsInToken}){
    let fiatQuantityRational = null;
    const trackerLinkToFiat = getTrackerLinkToFiat(tracker);
    if (priceIsInToken && tracker.mostRecentPrices.comparatorRational === null){
        throw Error("Cannot derive fiat from price in token if tracker does not yet have comparatorRational.");
    }
    if (trackerLinkToFiat){
        fiatQuantityRational = priceRational;
        for (let i = (priceIsInToken ? 0 : 1); i < trackerLinkToFiat.length; ++i){
            const uplinkTracker = trackerLinkToFiat[i];
            if (uplinkTracker.mostRecentPrices.comparator.rational === null
            || Date.now() - uplinkTracker.mostRecentPrices.timestamp > 30000){
                await updatePrice(uplinkTracker);
            }           
            fiatQuantityRational = fiatQuantityRational.multiply(uplinkTracker.mostRecentPrices.comparator.rational);
        }
    }
    return fiatQuantityRational;
}
function getFiatQuantityRationalSync({tracker, priceRational, priceIsInToken}){
    let fiatQuantityRational = null;
    const trackerLinkToFiat = getTrackerLinkToFiat(tracker);
    if (priceIsInToken && tracker.mostRecentPrices.comparatorRational === null){
        throw Error("Cannot derive fiat from price in token if tracker does not yet have comparatorRational.");
    }
    if (trackerLinkToFiat){
        fiatQuantityRational = priceRational;
        for (let i = (priceIsInToken ? 0 : 1); i < trackerLinkToFiat.length; ++i){
            const uplinkTracker = trackerLinkToFiat[i];
            if (uplinkTracker.mostRecentPrices.comparator.rational === null){
                return null; //there's a break in the link and we can't fix it synchronously
            } 
            fiatQuantityRational = fiatQuantityRational.multiply(uplinkTracker.mostRecentPrices.comparator.rational);
        }
    }
    return fiatQuantityRational;
}


const trackerDatabase = {};

function isTrackerListeningForSwaps(tracker){
    return trackerDatabase[tracker.id].isListeningForSwaps;
}

//if no priceInComparatorRational is given, will call getQuoteInComparatorRational to figure out current price
async function updatePrice(tracker, priceInComparatorRational, timestamp){
    const trackerData = trackerDatabase[tracker.id];
    if (!priceInComparatorRational){
        if (trackerData.priceIsUpdating){
            const mostRecentPrices = await new Promise((resolve, reject) => {
                trackerData.eventEmitter.once(TRACKER_DATA_EVENTS.PRICE_UPDATE, function(e) {
                    return resolve(tracker.mostRecentPrices);
                })
            });
            if (mostRecentPrices){
                return mostRecentPrices;
            }
        }
        if (trackerData.isStreamingTestDataSemaphore === 0){
            priceInComparatorRational = await trackerData.getQuoteInComparatorRational(tracker);
        } else {
            priceInComparatorRational = mostRecentPrices.comparator.rational;
        }
    }

    trackerData.priceIsUpdating = true;

    const priceInFiatRational = await getFiatQuantityRational({
        tracker, priceRational: priceInComparatorRational,
    });

    const mostRecentPrices = {
        comparator: {
            rational: priceInComparatorRational,
            string: util.formatRational(priceInComparatorRational, tracker.comparator.decimals)
        }, 
        fiat:{
            rational: priceInFiatRational,
            string: priceInFiatRational === null ? null : util.formatRational(priceInFiatRational, FIAT_DEFAULT_DECIMALS),
        },
        timestamp: timestamp || Date.now()
    };
    tracker.mostRecentPrices = mostRecentPrices;
    trackerData.priceIsUpdating = false;
    trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.PRICE_UPDATE);
    return mostRecentPrices;
}

async function createTrackerObject({
    backendName, token, comparator, pair, refreshSwapStream, getQuoteInComparatorRational, getUplinkTrackers, 
    processBeforeFirstPriceUpdate, extraProperties
}){
    const trackerId = util.getUniqueId();
    const trackerData = {
        isListeningForSwaps: false, 
        isStreamingTestDataSemaphore: 0,
        keyToSwapListenerRegistration: {}, 
        keyToPollRegistration: {}, 
        pollSwapKeyToInfo: {},
        testStreamKeyToInfo: {},
        eventEmitter: new EventEmitter(),
        priceIsUpdating: false,
        getQuoteInComparatorRational, refreshSwapStream, getUplinkTrackers,
        
    };
    trackerDatabase[trackerId] = trackerData;

    async function awaitTestStreamStatusCheck({testStreamKey, status}){
        while (true){
            if (trackerData.testStreamKeyToInfo[testStreamKey].status === status){
                return true;
            }
            if (trackerData.testStreamKeyToInfo[testStreamKey].status === TEST_STREAM_STATUS.ENDED){
                return false;
            }
            await new Promise((resolve, reject) => {
                trackerData.eventEmitter.once(TRACKER_DATA_EVENTS.TEST_STREAM_STATUS_UPDATED, resolve);
            });
        }
    }

    const tracker = {
        id: trackerId,
        backendName,
        
        token, comparator, pair,
        mostRecentPrices: {
            comparator: {
                rational: null,
                string: null
            }, 
            fiat:{
                rational: null,
                string: null,
            },
            timestamp: 0
        },

        addSwapListener: ({listener}) => {
            const key = util.getUniqueId();
            const internalListener = function(eventObject, tracker){
                //don't remove this check- some implementations pile up the events so that they still 
                //come through for a bit after removing listener
                if (trackerData.keyToSwapListenerRegistration[key]){
                    listener(eventObject, tracker);
                }
            }
            
            trackerData.keyToSwapListenerRegistration[key] = {internalListener};
            trackerData.eventEmitter.addListener(TRACKER_DATA_EVENTS.SWAP, internalListener);
            trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.USER_LISTENER_CONNECTED);

            if (!trackerData.isListeningForSwaps){
                trackerData.isListeningForSwaps = true;
                if (trackerData.isStreamingTestDataSemaphore === 0){
                    refreshSwapStream(tracker, true);
                }
                
            }

            return key;
        },
        addPollingListener: ({listener, pollIntervalSeconds}) => {
            const key = util.getUniqueId();
            trackerData.keyToPollRegistration[key] = {pollTimeout: null};

            const pollHandler = async () => {
                let mostRecentPrices = tracker.mostRecentPrices;
                if (trackerData.isStreamingTestDataSemaphore === 0){
                    mostRecentPrices = await updatePrice(tracker);
                }
                const eventObject = {
                    action: "POLL",
                    trackerId: tracker.id,
                    timestamp: mostRecentPrices.timestamp,
                    ... await deriveTradeDetails({
                        tokenQuantityString: '1', 
                        comparatorQuantityString: mostRecentPrices.comparator.string, 
                        possibleTrackers: [tracker],
                        timestamp: mostRecentPrices.timestamp
                    })
                };
                if (trackerData.isStreamingTestDataSemaphore === 0){
                    trackerData.keyToPollRegistration[key].pollTimeout = setTimeout(pollHandler, pollIntervalSeconds*1000);
                    listener(eventObject, tracker, key);
                } else {
                    listener(eventObject, tracker, key);
                    const startTimestamp = tracker.mostRecentPrices.timestamp;
                    await new Promise((resolve, reject) => {
                        const pollSwapKey = tracker.addSwapListener({listener: (details => {
                            if ((details.timestamp - startTimestamp)/1000 > pollIntervalSeconds){
                                tracker.removeListener({key: pollSwapKey});
                                resolve();
                            }
                        })});
                        if (!trackerData.keyToPollRegistration[key]){
                            tracker.removeListener({key: pollSwapKey});
                            resolve();
                        } else {
                            trackerData.pollSwapKeyToInfo[pollSwapKey] = {key, resolve};
                        }
                        
                    });
                    if (trackerData.keyToPollRegistration[key]){
                        setTimeout(pollHandler, 0);
                    } 
                }
            }
            trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.USER_LISTENER_CONNECTED);
            pollHandler();
            return key;
        },
        removeListener: ({key}) => {
            if (trackerData.pollSwapKeyToInfo[key]){
                delete trackerData.pollSwapKeyToInfo[key];
            } else {
                for (const pollSwapKey of Object.keys(trackerData.pollSwapKeyToInfo)){
                    const info = trackerData.pollSwapKeyToInfo[pollSwapKey];
                    if (info.key === key){
                        tracker.removeListener({key: pollSwapKey});
                        info.resolve();
                    }
                }
            }

            if (trackerData.keyToSwapListenerRegistration[key]){
                const registration = trackerData.keyToSwapListenerRegistration[key];
                trackerData.eventEmitter.removeListener(TRACKER_DATA_EVENTS.SWAP, registration.internalListener);
                delete trackerData.keyToSwapListenerRegistration[key];
                if (!Object.keys(trackerData.keyToSwapListenerRegistration).length){
                    trackerData.isListeningForSwaps = false;
                    if (trackerData.isStreamingTestDataSemaphore === 0){
                        refreshSwapStream(tracker, false);
                    }
                } 
            } else if (trackerData.keyToPollRegistration[key]){
                clearTimeout(trackerData.keyToPollRegistration[key].pollTimeout);
                delete trackerData.keyToPollRegistration[key];
            }          
        },

        startTestStream: ({testData, secondsBetween}) => {
            const testStreamKey = util.getUniqueId();
            trackerData.testStreamKeyToInfo[testStreamKey] = {status: TEST_STREAM_STATUS.RUNNING, notes: []};

            //We don't want users to await setTestData
            (async ()=> {
                trackerData.isStreamingTestDataSemaphore  += 1;
                const checkedTestData = [];
                try {
                    for (const testDatum of testData){
                        const action = testDatum.action || 'TEST';
                        const timestamp = testDatum.timestamp ? Number(testDatum.timestamp) : Date.now();
                        
                        let priceComparatorRational;
                        if (!testDatum.price){
                            if (!testDatum.tokenQuantity || !testDatum.comparatorQuantity){
                                throw Error("Test data without prices must contain tokenQuantity and comparatorQuantity");
                            }
                            priceComparatorRational = bigRational(testDatum.comparatorQuantity).divide(testDatum.tokenQuantity);
                        } else {
                            priceComparatorRational = bigRational(testDatum.price);
                        }
    
                        let tokenQuantityRational;
                        let comparatorQuantityRational;
                        if (testDatum.tokenQuantity && testDatum.comparatorQuantity){
                            tokenQuantityRational = bigRational(testDatum.tokenQuantity);
                            comparatorQuantityRational = bigRational(testDatum.comparatorQuantity);
                        } else if (testDatum.tokenQuantity && !testDatum.comparatorQuantity){
                            tokenQuantityRational = bigRational(testDatum.tokenQuantity);
                            comparatorQuantityRational = tokenQuantityRational.multiply(priceComparatorRational);
                        } else if (!testDatum.tokenQuantity && testDatum.comparatorQuantity){
                            comparatorQuantityRational = bigRational(testDatum.comparatorQuantity);
                            tokenQuantityRational = priceComparatorRational.divide(tokenQuantityRational);
                        } else {
                            tokenQuantityRational = bigRational(1);
                            comparatorQuantityRational = tokenQuantityRational.multiply(priceComparatorRational);
                        }
    
                        checkedTestData.push({tracker, action, timestamp, tokenQuantityRational, comparatorQuantityRational});
                    }
                    
                    if (checkedTestData.length){
                        //we have to do this manually, synchronously here so that any modules called afterwards that rely on
                        //e.g. percentage changes in price will be starting with the first test data
                        const firstTrade = checkedTestData.shift();
                        const averageTokenPriceComparatorRational = firstTrade.comparatorQuantityRational.divide(firstTrade.tokenQuantityRational);
                        const averageTokenPriceFiatRational = getFiatQuantityRationalSync({
                            tracker, priceRational: averageTokenPriceComparatorRational
                        })
                        tracker.mostRecentPrices = {
                            comparator: {
                                rational: averageTokenPriceComparatorRational,
                                string: util.formatRational(averageTokenPriceComparatorRational, tracker.comparator.decimals)
                            }, 
                            fiat:{
                                rational: averageTokenPriceFiatRational,
                                string: averageTokenPriceFiatRational === null ? null : util.formatRational(averageTokenPriceFiatRational, FIAT_DEFAULT_DECIMALS),
                            },
                            timestamp: firstTrade.timestamp
                        };
                        tracker.addTestStreamNote({testStreamKey, text: "TEST START"});
                        trackerData.testStreamKeyToInfo[testStreamKey].startTimestamp = firstTrade.timestamp;

                    }

                    //This await is important because it also means we wait this execution frame out before
                    //to give the caller a chance to connect listeners before we start streaming the test data
                    if (!(await awaitTestStreamStatusCheck({testStreamKey, status: TEST_STREAM_STATUS.RUNNING}))){
                        return;
                    }
                    if (trackerData.testStreamKeyToInfo[testStreamKey].status !== TEST_STREAM_STATUS.RUNNING){
                        return;
                    }
    
                    for (const checkedTestDatum of checkedTestData){
                        if (secondsBetween && secondsBetween> 0){
                            await util.awaitMs(secondsBetween*1000);
                        } else {
                            await util.awaitMs(0); 
                        }
                        if (!(await awaitTestStreamStatusCheck({testStreamKey, status: TEST_STREAM_STATUS.RUNNING}))){
                            return;
                        }
                        await processTrade(checkedTestDatum);
                        if (!(await awaitTestStreamStatusCheck({testStreamKey, status: TEST_STREAM_STATUS.RUNNING}))){
                            return;
                        }
                    }
                } finally {
                    trackerData.isStreamingTestDataSemaphore -= 1;
                    tracker.endTestStream({testStreamKey});
                }
            })();

            return testStreamKey;
        },

        pauseTestStream: ({testStreamKey}) => {
            trackerData.testStreamKeyToInfo[testStreamKey].status = TEST_STREAM_STATUS.PAUSED;
            trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.TEST_STREAM_STATUS_UPDATED, {testStreamKey});
        },
        unpauseTestStream: async ({testStreamKey}) => {
            await util.awaitMs(0); //to give time for user to add listeners
            trackerData.testStreamKeyToInfo[testStreamKey].status = TEST_STREAM_STATUS.RUNNING;
            trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.TEST_STREAM_STATUS_UPDATED, {testStreamKey});
        },

        endTestStream: ({testStreamKey}) => {
            if (trackerData.testStreamKeyToInfo[testStreamKey].status !== TEST_STREAM_STATUS.ENDED){
                tracker.addTestStreamNote({testStreamKey, text: "TEST END"});
                trackerData.testStreamKeyToInfo[testStreamKey].status = TEST_STREAM_STATUS.ENDED;
                trackerData.eventEmitter.emit(TRACKER_DATA_EVENTS.TEST_STREAM_STATUS_UPDATED, {testStreamKey});
            }
            if (Object.keys(trackerData.keyToSwapListenerRegistration).length
            || Object.keys(trackerData.keyToPollRegistration).length){
                log("WARNING: Test stream has ended but some price listeners remain");
                log(trackerData.testStreamKeyToInfo[testStreamKey].notes.map(
                    note =>`${note.date} (${note.priceSnapshot.comparator.string}): ${note.text}`
                ));
            }
        },

        awaitTestStreamEnd: async ({testStreamKey}) => {
            return awaitTestStreamStatusCheck({testStreamKey, status: TEST_STREAM_STATUS.ENDED})
        },

        addTestStreamNote: ({testStreamKey, text}) => {
            const note = {
                text,
                priceSnapshot: tracker.mostRecentPrices,
                date: new Date(tracker.mostRecentPrices.timestamp),
                realTimestamp: Date.now()
            }
            trackerData.testStreamKeyToInfo[testStreamKey].notes.push(note);
            log(`${note.date} (${tracker.mostRecentPrices.comparator.string}): ${note.text}`);
        },

        getTestStreamNotes: ({testStreamKey}) => {
            return trackerData.testStreamKeyToInfo[testStreamKey].notes;
        }
    }

    addExtraProperties(tracker, extraProperties);
    if (processBeforeFirstPriceUpdate){
        await processBeforeFirstPriceUpdate(tracker);
    }
    await updatePrice(tracker);
    return tracker;
}



async function processTrade({tracker, action, timestamp, tokenQuantityRational, comparatorQuantityRational, extraProperties}){
    if (tokenQuantityRational.lesserOrEquals('0')){
        return;
    }
    const tokenQuantityString = util.formatRational(tokenQuantityRational, tracker.token.decimals);
    const comparatorQuantityString = util.formatRational(comparatorQuantityRational, tracker.comparator.decimals);
    const averageTokenPriceComparatorRational = comparatorQuantityRational.divide(tokenQuantityRational);
    updatePrice(tracker, averageTokenPriceComparatorRational, timestamp);

    const tradeDetails = await deriveTradeDetails({
        tokenQuantityString,
        comparatorQuantityString,
        possibleTrackers: [tracker]
    });
  
    const eventObject = {
        trackerId: tracker.id,
        timestamp,
        action,
        ...tradeDetails
    }

    addExtraProperties(eventObject, extraProperties);
    trackerDatabase[tracker.id].eventEmitter.emit(TRACKER_DATA_EVENTS.SWAP, eventObject, tracker);
}


function addExtraProperties(baseObject, extraProperties){
    if (extraProperties){
        for (const key of Object.keys(extraProperties)){
            if (!baseObject.hasOwnProperty(key)){
                baseObject[key] = extraProperties[key];
            }
        }
    }
}





async function deriveTradeDetails({tokenQuantityString, comparatorQuantityString, comparatorDecimals, possibleTrackers}){
    const tokenQuantityRational = bigRational(tokenQuantityString);
    const comparatorQuantityRational = bigRational(comparatorQuantityString);
    
    let fiatQuantityRational = null, fiatQuantityString = null, 
        averageTokenPriceFiatRational = null, averageTokenPriceFiatString = null;
    let averageTokenPriceComparatorString = '0';
    let averageTokenPriceComparatorRational = bigRational(averageTokenPriceComparatorString);
    if (tokenQuantityRational.greater(0)){
        averageTokenPriceComparatorRational = comparatorQuantityRational.divide(tokenQuantityRational);
        averageTokenPriceComparatorString = util.formatRational(averageTokenPriceComparatorRational, comparatorDecimals);
    
        for (const tracker of possibleTrackers){
            averageTokenPriceFiatRational = await getFiatQuantityRational({tracker, priceRational: averageTokenPriceComparatorRational})
            if (averageTokenPriceFiatRational){
                averageTokenPriceFiatString = util.formatRational(averageTokenPriceFiatRational, FIAT_DEFAULT_DECIMALS);
                fiatQuantityRational = averageTokenPriceFiatRational.multiply(tokenQuantityRational);
                fiatQuantityString = util.formatRational(fiatQuantityRational, FIAT_DEFAULT_DECIMALS);
            }
        }
    }

    return {
        tokenQuantity: {
            rational: tokenQuantityRational,
            string: tokenQuantityString
        },
        comparatorQuantity: {
            rational: comparatorQuantityRational,
            string: comparatorQuantityString
        },
        averageTokenPriceComparator: {
            rational: averageTokenPriceComparatorRational,
            string: averageTokenPriceComparatorString
        },
        averageTokenPriceFiat: {
            rational: averageTokenPriceFiatRational,
            string: averageTokenPriceFiatString
        },
        fiatQuantity: {
            rational: fiatQuantityRational,
            string: fiatQuantityString
        }
    }

}





//assume LOT_SIZE filters apply even if quantity specified is comparatorSymbol- if you don't want them, don't include them in filters
function massageCexMarketSwapData({type, exactSymbol, tokenSymbol, 
exactQuantityString, symbolToBalancesRational, symbolToDecimals, filters, currentPriceInComparatorString}){
    const isBuy = type === 'BUY';

    let inexactSymbol;
    let comparatorSymbol;
    for (const symbol of Object.keys(symbolToBalancesRational)){
        if (symbol !== exactSymbol){
            inexactSymbol = symbol;
        }
        if (symbol !== tokenSymbol){
            comparatorSymbol = symbol;
        }
    }

    let exactQuantityRational;
    if (exactQuantityString.endsWith('%')){
        exactQuantityString = util.trim(exactQuantityString, '%');
        exactQuantityRational = bigRational(exactQuantityString).divide(100).multiply(symbolToBalancesRational[exactSymbol]);
        const oldQuantityString = exactQuantityString;
        exactQuantityString = util.formatRational(exactQuantityRational, symbolToDecimals[exactSymbol].decimals);
        log(`${exactSymbol} quantity: ${oldQuantityString}% of ${util.formatRational(symbolToBalancesRational[exactSymbol], symbolToDecimals[exactSymbol])} = ${exactQuantityString}`);
    } else {
        exactQuantityRational = bigRational(exactQuantityString);
        log(`${exactSymbol} quantity: ${exactQuantityString}`);
    }

    //assumes if stepSize is given for both, they are the same
    for (const filter of filters){
        if (filter.type === "LOT_SIZE"){
            const {minQuantityString, maxQuantityString, stepSizeString} = filter;
            const minQuantityRational = bigRational(minQuantityString);
            const maxQuantityRational = bigRational(maxQuantityString);
            if (exactQuantityRational.lesser(minQuantityRational)){
                throw Error(`Quantity is less than minimum of ${minQuantityString}`);
            }
            if (maxQuantityRational.greater(0) && exactQuantityRational.greater(maxQuantityRational)){
                throw Error(`Quantity is greater than maximum of ${maxQuantityString}`);
            }
            const stepSizeRational = bigRational(stepSizeString);
            const quantityOverMinRational = exactQuantityRational.minus(minQuantityRational);
            if (!stepSizeRational.isZero() && !minQuantityRational.isZero()){
                const modRational = (quantityOverMinRational.mod(stepSizeRational));
                if (!modRational.isZero()){
                    exactQuantityRational = minQuantityRational.add(stepSizeRational.multiply(quantityOverMinRational.divide(stepSizeRational).floor()));
                    exactQuantityString = exactQuantityRational.toDecimal(symbolToDecimals[exactSymbol]);
                    log(`Quantity is not ${minQuantityString} + a multiple of ${stepSizeString}. Floored down to ${exactQuantityString}`);
                }
            }
        }
    }
    for (const filter of filters){
            //doesn't make sense to filter minNotional if the specified quantity isn't in tokenSymbol
        if (filter.type === 'MIN_NOTIONAL' && exactSymbol === tokenSymbol){
            if (exactQuantityRational.multiply(currentPriceInComparatorString).lesser(filter.minNotionalString)){
                throw Error(`MIN_NOTIONAL: Price * quantity (${price} * ${currentPriceInComparatorString}) is less than ${filter.minNotionalString})`);
            }
        }
    }


    if (isBuy && exactSymbol === comparatorSymbol || !isBuy && exactSymbol === tokenSymbol){
        log(`Swap exactly ${exactQuantityString} ${exactSymbol} for as many ${inexactSymbol} as possible`);
        if (symbolToBalancesRational[exactSymbol].lesser(exactQuantityRational)){
            throw Error(`Insufficient ${exactSymbol} balance`);
        }
    } else if (isBuy && exactSymbol === tokenSymbol || !isBuy && exactSymbol === comparatorSymbol){
        log(`Swap as many ${inexactSymbol} as necessary for exactly ${exactQuantityString} ${exactSymbol}`);
        //we could estimate whether user is over-reaching but we don't know the what the execution price will actually be...
    }

    return {
        exactQuantityString
    }
}


//fetchMinuteKlines should fetch as many minute klines as possible back from a given end date, ordered chronologically
//getKlineObjectFromKline should take whatever the minute klines come as, and return a kline object formatted for botiq
async function getHistoryMinuteKlines({startTimeMs, endTimeMs, fetchMinuteKlines, getKlineObjectFromKline}){
    startTimeMs = Math.floor(startTimeMs / (1000 * 60)) * 1000 * 60; //round down to closest utc minute

    let movingEndTimeMs = endTimeMs;
    const klineObjects = [];
    do {
        const response = await fetchMinuteKlines({endTimeMs: movingEndTimeMs}); 
        const klineArrays = response.data;
        klineArrays.reverse();
        for (const klineArray of klineArrays){
            if (klineArray[0] >= startTimeMs){
                const klineObject = getKlineObjectFromKline({klineArray});
                klineObjects.push(klineObject)
            } else {
                //we're going from most recent to earliest because we reverse the received data
                //so if we're below startTimeMs, we can just return what we have
                klineObjects.reverse();
                return klineObjects;
            }
        }
        movingEndTimeMs = klineObjects[klineObjects.length - 1].timestamp - 60 * 1000;
    } while (!startTimeMs || klineObjects[klineObjects.length - 1].timestamp > startTimeMs);

    klineObjects.reverse();
    return klineObjects;
}







export default {
    FIAT_DEFAULT_DECIMALS,
    getFiatQuantityRational, createTrackerObject, isTrackerListeningForSwaps, 
    processTrade, deriveTradeDetails, massageCexMarketSwapData, getHistoryMinuteKlines
};
