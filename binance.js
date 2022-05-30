import {Spot} from '@binance/connector';
import APIBase from '@binance/connector/src/APIBase.js';
import bigRational from "big-rational";
import * as util from './util.js';
import common from './common.js';
import {log} from './logger.js';
import fetch from 'node-fetch';

const connectionDatabase = {};
const trackerDatabase = {};


//a single connection to stream.binance.com is only valid for 24 hours; expect to be disconnected at the 24 hour mark
function resetConnection(connectionId){
    const connectionPrivate = connectionDatabase[connectionId]?.connectionPrivate;
    if (connectionPrivate){
        connectionPrivate.refreshSwapStream();
    }
}



function getUplinkTrackers(tracker){
    const uplinkTrackers = [];
    const uplinkTrackerIds = connectionDatabase[tracker.connectionId].connectionPrivate.tokenSymbolToTrackerIds[tracker.comparator.symbol];
    if (uplinkTrackerIds){
        for (const trackerId of uplinkTrackerIds){
            uplinkTrackers.push(trackerDatabase[trackerId].tracker);
        }
    }
    return uplinkTrackers;
}



async function getQuoteInComparatorRational(tracker){
    const response = await connectionDatabase[tracker.connectionId].connectionPrivate.client.tickerPrice(tracker.ticker);
    return bigRational(response.data.price);
}





async function createTracker({connectionId, tokenSymbol, comparatorSymbol, comparatorIsFiat}){
    comparatorIsFiat = !!comparatorIsFiat;
    tokenSymbol = tokenSymbol.toUpperCase();
    comparatorSymbol = comparatorSymbol.toUpperCase();
    const ticker = tokenSymbol + comparatorSymbol;

    for (const trackerId of Object.values(connectionDatabase[connectionId].connectionPrivate.streamNameToTrackerId)){
        const tracker = tracker[trackerId].tracker;
        if (tracker.token.symbol === tokenSymbol && tracker.comparator.symbol === comparatorSymbol){
            return tracker;
        }
    }
    
    const pairExchangeParameters = (await connectionDatabase[connectionId].connectionPrivate.client.exchangeInfo({ symbol: ticker })).data.symbols[0];

    const trackerPrivate = {
        streamName: `${tokenSymbol.toLowerCase()}${comparatorSymbol.toLowerCase()}@trade`,
    }

    return common.createTrackerObject({
        backendName: 'binance',
        token: {
            symbol: tokenSymbol,
            decimals: pairExchangeParameters.baseAssetPrecision
        },
        comparator: {
            symbol: comparatorSymbol,
            decimals: pairExchangeParameters.quoteAssetPrecision
        },
        pair: {comparatorIsFiat},
        refreshSwapStream: () => connectionDatabase[connectionId].connectionPrivate.refreshSwapStream(), 
        getQuoteInComparatorRational,
        getUplinkTrackers,
        processBeforeFirstPriceUpdate: (tracker) => {
            trackerDatabase[tracker.id] = {tracker, trackerPrivate};
            if (!connectionDatabase[connectionId].connectionPrivate.tokenSymbolToTrackerIds[tokenSymbol]){
                connectionDatabase[connectionId].connectionPrivate.tokenSymbolToTrackerIds[tokenSymbol] = [];
            }
            connectionDatabase[connectionId].connectionPrivate.tokenSymbolToTrackerIds[tokenSymbol].push(tracker.id);
            
        },
        extraProperties: {
            connectionId,
            ticker,
            buyTokensWithExact: async function({exactComparatorQuantity}){
                return  swap({connectionId, type: 'BUY', tokenSymbol, comparatorSymbol, exactSymbol: comparatorSymbol, exactQuantity: exactComparatorQuantity});
            },
            sellTokensForExact: async function({exactComparatorQuantity}){
                return  swap({connectionId, type: 'SELL', tokenSymbol, comparatorSymbol, exactSymbol: comparatorSymbol, exactQuantity: exactComparatorQuantity});
            },
            buyExactTokens: async function({exactTokenQuantity}){
                return  swap({connectionId, type: 'BUY', tokenSymbol, comparatorSymbol, exactSymbol: tokenSymbol, exactQuantity: exactTokenQuantity});
            },
            sellExactTokens: async function({exactTokenQuantity}){
                return  swap({connectionId, type: 'SELL', tokenSymbol, comparatorSymbol, exactSymbol: tokenSymbol, exactQuantity: exactTokenQuantity});
            },
            getHistoryMinuteKlines: async function({startTimeMs, endTimeMs, cutVolumeAsIfEveryNthTrade}){
                return common.getHistoryMinuteKlines({
                    startTimeMs, endTimeMs,
                    fetchMinuteKlines: ({endTimeMs}) => connectionDatabase[connectionId].connectionPrivate.client.klines(ticker, '1m', {limit: 1000, endTime: endTimeMs}),
                    getKlineObjectFromKline: ({klineArray}) => {
                        const klineObject = {
                            timestamp: klineArray[0],
                            open: klineArray[1],
                            high: klineArray[2],
                            low: klineArray[3],
                            close: klineArray[4],
                            volume: {
                                token: klineArray[5],
                                comparator: klineArray[7],
                            }
                        }
                        if (cutVolumeAsIfEveryNthTrade){
                            klineObject.volume.token = (Number(klineObject.volume.token) / cutVolumeAsIfEveryNthTrade).toString();
                            klineObject.volume.comparator = (Number(klineObject.volume.comparator) / cutVolumeAsIfEveryNthTrade).toString();
                        }
                        return klineObject;
                    }
                });
            }
        }        
    });
}


const WITHDRAW_STATUS = {
    EMAIL_SENT: 0,
    CANCELLED: 1,
    AWAITING_APPROVAL: 2,
    REJECTED: 3,
    PROCESSING: 4,
    FAILURE: 5,
    COMPLETED: 6,
    getStatusKey: statusInt => {
        for (const key of Object.keys(WITHDRAW_STATUS)){
            if (WITHDRAW_STATUS[key] === statusInt){
                return key;
            }
        }
    }
}
const DEPOSIT_STATUS = {
    PENDING: 0,
    CREDITED_BUT_CANNOT_WITHDRAW: 6,
    SUCCESS: 1,
    getStatusKey: statusInt => {
        for (const key of Object.keys(DEPOSIT_STATUS)){
            if (DEPOSIT_STATUS[key] === statusInt){
                return key;
            }
        }
    }
}





//UNTESTED
//if network is undefined, resolves to default network of coin
//you can find all that info here: sapi/v1/capital/config/getall
async function withdraw({connectionId, walletAddress, tokenSymbol, tokenQuantityString, network}){
    tokenSymbol = tokenSymbol.toUpperCase();
    const client = connectionDatabase[connectionId].connectionPrivate.client;

    const basePrecision = 20;
    const accountInfo = (await client.account()).data;
    if (!canWithdraw){
        throw Error( 'API restricted (withdraws disallowed)');
    }

    let balanceOfTokenRational = bigRational(0);
    for (const balance of accountInfo.balances){
        if (balance.asset === tokenSymbol){
            balanceOfTokenRational = bigRational(balance.free);
        }
    }

    if (tokenQuantityString.endsWith('%')){
        tokenQuantityString = util.trim(tokenQuantityString, '%');
        const exactQuantityRational = bigRational(tokenQuantityString).divide(100).multiply(balanceOfTokenRational);
        tokenQuantityString = util.formatRational(exactQuantityRational, basePrecision);
        log(`Quantity: ${tokenQuantityString} % of ${util.formatRational(balanceOfTokenRational, basePrecision)} = ${tokenQuantityString}`);
    }

    if (network){
        log( `Sending ${tokenQuantityString} ${tokenSymbol} to ${network}...`)
    } else {
        log(`Sending ${tokenQuantityString} ${tokenSymbol} to default network...`);
    }

   return (await client.withdraw(tokenSymbol, walletAddress, Number(tokenQuantityString), { network })).data;
}



async function awaitDepositOrWithdraw({type, connectionId, filter, intervalSecs, timeoutSecs}){
    const client = connectionDatabase[connectionId].connectionPrivate.client;
    const intervalMS = (intervalSecs ? intervalSecs : 5) * 1000;
    const timeoutMS = (timeoutSecs ? timeoutSecs : 60) * 1000;
    const msAtStart = new Date().getTime();

    let lastStatus;
    let lastTransactionHash; 
    
    while (new Date().getTime() - msAtStart < timeoutMS){
        const transactionInfos = (await (type === 'Deposit' ? client.depositHistory({limit: 20}) : client.withdrawHistory({limit: 20}))).data;
        let matchingTransactionInfo;
        for (const transactionInfo of transactionInfos){
            if (!Object.keys(filter).some(key => {
                if (typeof filter[key] === 'string' && typeof transactionInfo[key] === 'string'){
                    return filter[key].toLowerCase() !== transactionInfo[key].toLowerCase();
                } else {
                    return filter[key] !== transactionInfo[key];
                }
            })){
                matchingTransactionInfo = transactionInfo;
                break;
            }
        }
        
        if (matchingTransactionInfo){
            if (type === 'Withdraw'){
                matchingTransactionInfo.statusString = WITHDRAW_STATUS.getStatusKey(matchingTransactionInfo.status);
            } else {
                matchingTransactionInfo.statusString = DEPOSIT_STATUS.getStatusKey(matchingTransactionInfo.status);
            }
            
            if (lastStatus !== matchingTransactionInfo.status || lastTransactionHash !== matchingTransactionInfo.txId){
                lastStatus = matchingTransactionInfo.status;
                lastTransactionHash = matchingTransactionInfo.txId;
            }
            
            if (type === 'Withdraw'){
                if (matchingTransactionInfo.status === WITHDRAW_STATUS.COMPLETED){
                    return matchingTransactionInfo;
                } else if (matchingTransactionInfo.status === WITHDRAW_STATUS.FAILURE
                || matchingTransactionInfo.status === WITHDRAW_STATUS.REJECTED
                || matchingTransactionInfo.status === WITHDRAW_STATUS.CANCELLED){
                    throw Error(`Withdrawal failed, rejected or cancelled`);
                }
            } else {
                if (matchingTransactionInfo.status === DEPOSIT_STATUS.SUCCESS){
                        return matchingTransactionInfo;
                    }
            }
        }
            
        await util.awaitMs(intervalMS);
    }
    throw Error(`Timeout!`);
}














//apiSecret can be omitted if you aren't using the connection for any account-specific stuff
function createConnection({apiKey, apiSecret}){
    const connectionId = util.getUniqueId();

    const connection = {
        id: connectionId,
        
        createTracker: ({tokenSymbol, comparatorSymbol, comparatorIsFiat}) => {
            return createTracker({connectionId, tokenSymbol, comparatorSymbol, comparatorIsFiat})
        },
        
        getBalance: async function({tokenSymbol}){
            tokenSymbol = tokenSymbol.toUpperCase();
            log(`Retreiving ${tokenSymbol} balance...`);
            const accountInfo = (await connectionDatabase[connectionId].connectionPrivate.client.account()).data;
            for (const balance of accountInfo.balances){
                if (balance.asset.toUpperCase() === tokenSymbol){
                    return {rational: bigRational(balance.free), string: balance.free};
                }
            }
            return {rational: bigRational(0), string: '0'};
        },
        unsignedQuery: async function({queryString}){
            const baseUrl = 'https://api.binance.com';
            const url = new URL(`${baseUrl}/${util.trim(queryString, '/')}`);
            return (await fetch(url.href)).json(); 
        },
        signedQuery: async function({queryString}){
            const baseUrl = 'https://api.binance.com';
            const url = new URL(`${baseUrl}/${util.trim(queryString, '/')}`);
            const params = {};
            for (const param of url.searchParams.keys()){
                params[param] = url.searchParams.get(param);
            }
            const binanceApi = new APIBase({apiKey, apiSecret, baseUrl});
            return (await binanceApi.signRequest('GET', baseUrl + url.pathname, params)).data;
        },
        
        withdraw: async ({walletAddress, tokenSymbol, tokenQuantityString, network}) => withdraw({connectionId, walletAddress, tokenSymbol, tokenQuantityString, network}),
        awaitWithdraw: async ({filter, intervalSecs, timeoutSecs}) => awaitDepositOrWithdraw({type: 'Withdraw', connectionId, filter, intervalSecs, timeoutSecs}),
        awaitDeposit: async ({filter, intervalSecs, timeoutSecs}) => awaitDepositOrWithdraw({type: 'Deposit', connectionId, filter, intervalSecs, timeoutSecs}),
        awaitDepositTransaction: async ({transactionHash, intervalSecs, timeoutSecs}) => awaitDepositOrWithdraw({type: 'Deposit', connectionId, filter: {txId: transactionHash}, intervalSecs, timeoutSecs}),


        buyTokensWithExact: async function({tokenSymbol, comparatorSymbol, exactComparatorQuantity}){
            return  swap({connectionId, type: 'BUY', tokenSymbol, comparatorSymbol, exactSymbol: comparatorSymbol, exactQuantity: exactComparatorQuantity});
        },
        sellTokensForExact: async function({tokenSymbol, comparatorSymbol, exactComparatorQuantity}){
            return  swap({connectionId, type: 'SELL', tokenSymbol, comparatorSymbol, exactSymbol: comparatorSymbol, exactQuantity: exactComparatorQuantity});
        },
        buyExactTokens: async function({tokenSymbol, comparatorSymbol, exactTokenQuantity}){
            return  swap({connectionId, type: 'BUY', tokenSymbol, comparatorSymbol, exactSymbol: tokenSymbol, exactQuantity: exactTokenQuantity});
        },
        sellExactTokens: async function({tokenSymbol, comparatorSymbol, exactTokenQuantity}){
            return  swap({connectionId, type: 'SELL', tokenSymbol, comparatorSymbol, exactSymbol: tokenSymbol, exactQuantity: exactTokenQuantity});
        },
    };

    const connectionPrivate = {
        connectionId,
        client: new Spot(apiKey, apiSecret ? apiSecret : ''),
        websocket: null,
        streamNameToTrackerId: {},
        resetConnectionTimeout: null,
        tokenSymbolToTrackerIds: {}
    }

    connectionPrivate.stopSwapStream = function() {
        if (connectionPrivate.websocket){
            connectionPrivate.client.unsubscribe(connectionPrivate.websocket);
        }
        if (connectionPrivate.resetConnectionTimeout){
            clearTimeout(connectionPrivate.resetConnectionTimeout);
            connectionPrivate.resetConnectionTimeout = null;
        }
        connectionPrivate.websocket = null;
    }
    connectionPrivate.refreshSwapStream = function() {
        connectionPrivate.stopSwapStream();
        const streamNames = [];
        const streamNameToTracker = {};
        for (const {tracker, trackerPrivate} of Object.values(trackerDatabase)){
            if (tracker.connectionId === connectionId && common.isTrackerListeningForSwaps(tracker)){
                streamNames.push(trackerPrivate.streamName);
                streamNameToTracker[trackerPrivate.streamName] = tracker;
            }
        }
        if (streamNames.length){
            connectionPrivate.websocket = connectionPrivate.client.combinedStreams(streamNames, {
                open: () => {
                    log('stream open for ', connection.id);
                },
                close: () => {
                    log('stream closed for ', connection.id);
                },
                message: async (messageString) => {
                    const messageObject = JSON.parse(messageString);
                    const streamName = messageObject.stream;
                    if (messageObject.data.e === 'trade'){
                        const tracker = streamNameToTracker[streamName];
                        const timestamp = Number(messageObject.data.T);
                        const tokenQuantityRational = bigRational(messageObject.data.q);
                        const priceInComparatorRational = bigRational(messageObject.data.p);
                        const comparatorQuantityRational = priceInComparatorRational.multiply(tokenQuantityRational);
                        common.processTrade({tracker, action: "TRADE", timestamp, tokenQuantityRational, comparatorQuantityRational});
                    }  
                }
            });
            connectionPrivate.resetConnectionTimeout = setTimeout(resetConnection, 23 * 60 * 60 * 1000, connection.id);
        }
    }
        
    connectionDatabase[connection.id] = {connection, connectionPrivate};

    return connection;
}



//UNTESTED
async function swap({connectionId, type, tokenSymbol, comparatorSymbol, exactSymbol, exactQuantity}){
    const exactQuantityString = exactQuantity.toString();
    const ticker = `${tokenSymbol}${comparatorSymbol}`.toUpperCase();
    const inexactSymbol = exactSymbol === tokenSymbol ? comparatorSymbol : tokenSymbol;
    type = type.toUpperCase();
    
    const client = connectionDatabase[connectionId].connectionPrivate.client;
    const accountInfo = (await client.account()).data;
    if (!accountInfo.canTrade){
        throw Error(`Error: API restricted (trades disallowed)`);
    }
    
    const [pairExchangeParameters, currentPriceInComparatorString] = await Promise.all([
            (await client.exchangeInfo({ symbol: ticker })).data.symbols[0],
            (await client.tickerPrice(ticker)).data.price
    ]);
    const symbolToDecimals = {
        [tokenSymbol]: pairExchangeParameters.baseAssetPrecision,
        [comparatorSymbol]: pairExchangeParameters.quoteAssetPrecision
    }
    const filters = [];
    for (const filter of pairExchangeParameters.filters){
        filter.type = filter.filterType;
        //MARKET orders using quoteOrderQty (exactSymbol === comparatorSymbol) will not break LOT_SIZE filter rules; 
        //the order will execute a quantity that will have the notional value as close as possible to quoteOrderQty.
        //https://binance-docs.github.io/apidocs/spot/en/#new-order-trade
        if (exactSymbol !== comparatorSymbol && (filter.type === "MARKET_LOT_SIZE" || filter.type === "LOT_SIZE")){
            filter.minQuantityString = filter.minQty;
            filter.maxQuantityString = filter.maxQty;
            filter.stepSizeString = filter.stepSize;
            filters.push(filter);
        }
        if (filter.type === "MIN_NOTIONAL"){
            filter.minNotionalString = filter.minNotional;
            if (filter.applyToMarket){
                filters.push(filter);
            }
        }
        
    }
    
    let symbolToBalancesRational = {
        [tokenSymbol]: bigRational(0),
        [comparatorSymbol]: bigRational(0)
    }
    for (const balance of accountInfo.balances){
        if (symbolToBalancesRational[balance.asset]){
            symbolToBalancesRational[balance.asset] = bigRational(balance.free);
        }
    }

    const massagedData = common.massageCexMarketSwapData({
        type, exactSymbol, tokenSymbol, exactQuantityString, symbolToBalancesRational, 
        symbolToDecimals, filters, currentPriceInComparatorString
    });

    const options = {
        [exactSymbol === comparatorSymbol ? 'quoteOrderQty' : 'quantity']: massagedData.exactQuantityString,
        newOrderRespType: 'RESULT'
    };

    //todo: we might need to poll until the order is filled but I'm not sure 
    const response = (await client.newOrder(ticker, type, 'MARKET', options)).data;
    log(`Order ${response.orderId}: Filled ${response.executedQty} ${tokenSymbol} (${response.cummulativeQuoteQty} ${comparatorSymbol})`);
    
    const tokenQuantityString = response.executedQty;
    const comparatorQuantityString = response.cummulativeQuoteQty;
    const tradeDetails = await common.deriveTradeDetails({
        tokenQuantityString,
        comparatorQuantityString,
        comparatorDecimals: symbolToDecimals[comparatorSymbol],
        possibleTrackers: getTrackersBySymbols({tokenSymbol, comparatorSymbol})
    });
    
    return {
        ...response,
        ...tradeDetails
    }
}
    

function getTrackersBySymbols({tokenSymbol, comparatorSymbol}){
    const ret = [];
    for (const trackerId of Object.keys(trackerDatabase)){
        const tracker = trackerDatabase[trackerId].tracker;
        if (tracker.tokenSymbol === tokenSymbol && tracker.comparatorSymbol === comparatorSymbol){
            ret.push(tracker);
        }
    }
    return ret;
}

function getTestDataFromHistoricTradesFile({filepath, everyNthTrade}){
    return util.readDataLinesFromFile({
        filepath,
        lineProcessor: (lineIndex, line) => {
            if (!everyNthTrade || lineIndex % everyNthTrade === 0){
                const lineColumns = line.split(',');
                return {
                    price: lineColumns[1], 
                    tokenQuantity: lineColumns[2], 
                    comparatorQuantity: lineColumns[3],
                    timestamp: Number(lineColumns[4])
                };
            }
        }
    });
}




export default {createConnection, getTestDataFromHistoricTradesFile}
