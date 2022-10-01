import * as ethers from 'ethers';
const BigNumber = ethers.BigNumber;
import bigRational from "big-rational";
import { NonceManager } from "@ethersproject/experimental";
import {RateLimiter} from 'limiter';
import fs from 'fs';
import path from 'path';
import {log} from "./logger.js";
import * as util from './util.js';
import common from './common.js';
import ethersBase from './ethers-base.js';

const VALID_ERC20_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SWAP_FILTER_HASHED = ethers.utils.id("Swap(address,uint256,uint256,uint256,uint256,address)");
const TRANSFER_FILTER_HASHED = ethers.utils.id("Transfer(address,address,uint256)");

const CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME = "./cache/chain-contract-address-to-info-cache.json";

const chainDatabase = {};
const trackerDatabase = {};


readInContractAddressToInfoCache();


function readInContractAddressToInfoCache(){
    if (!fs.existsSync(CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME)){
        return;
    }
    const fileString = fs.readFileSync(CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME).toString('utf-8');
    const cache = JSON.parse(fileString);
    for (const chainId of Object.keys(cache)){
        if (!chainDatabase[chainId]){
            chainDatabase[chainId] = {
                tokenAddressToTrackerIds: {},
                trackerIds: [],
                contractAddressToInfoCache: {},
                contractAddressToRegisteredEvents: {},
                eventFilterToRegisteredEvents: {},
            }
        }
        chainDatabase[chainId].contractAddressToInfoCache = cache[chainId];
    }
}
function writeOutContractAddressToInfoCache(){
    if (!fs.existsSync(CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME)){
        fs.mkdirSync(path.dirname(CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME), {recursive: true});
    }
    const cache = {};
    for (const chainId of Object.keys(chainDatabase)){
        cache[chainId] = chainDatabase[chainId].contractAddressToInfoCache;
    }
    const filestring = JSON.stringify(cache, null," ");
    fs.writeFileSync(CHAIN_CONTRACT_ADDRESS_TO_INFO_CACHE_FILENAME, filestring);
}





async function createJsonRpcEndpoint({accessURL, rateLimitPerSecond, blockExplorerURL, fiatTokenAddress, nativeTokenAddress, defaultExchange, omitNativeTokenTrackerInit}){
    console.log('Adding endpoint...');

    const limiter =  new RateLimiter({ tokensPerInterval: rateLimitPerSecond, interval: "second" });
    const provider = new ethers.providers.JsonRpcProvider(accessURL);
    const chainId = (await provider.getNetwork()).chainId;
    if (!chainDatabase[chainId]){
        chainDatabase[chainId] = {
            tokenAddressToTrackerIds: {},
            trackerIds: [],
            contractAddressToInfoCache: {},
            contractAddressToRegisteredEvents: {},
            eventFilterToRegisteredEvents: {},
        }
    }
    
    let chainName;
    if (!nativeTokenAddress || !fiatTokenAddress || !defaultExchange){
        for (const chain of Object.values(ethersBase.chains)){
            if (chain.chainIds.includes(chainId)){
                chainName = chain.TAG;
                if (!nativeTokenAddress){
                    nativeTokenAddress = Object.values(chain.tokenAddresses)[0];
                } 
                if (!fiatTokenAddress){
                    fiatTokenAddress = Object.values(chain.tokenAddresses)[1];
                }
                if (!defaultExchange){
                    defaultExchange = Object.values(chain.exchanges)[0];
                }
                break;
            }
        }
    }
    if (!nativeTokenAddress){
        throw Error("Unable to resolve a native token address for chain id", chainId, "and none given");
    }
    if (!fiatTokenAddress){
        throw Error("Unable to resolve a default fiat token address for chain id", chainId, "and none given");
    }
    if (!defaultExchange){
        throw Error("Unable to resolve a default fiat token address for chain id", chainId);
    }
    const [nativeToken, fiatToken] = await Promise.all([
        getTokenInfoByAddress(nativeTokenAddress),
        getTokenInfoByAddress(fiatTokenAddress)
    ])


    async function getRecommendedGasGwei(){
        return ethers.utils.formatUnits(await sendOne(endpoint.provider, 'getGasPrice'), 'gwei');
    }

    async function getTokenInfoByAddress(tokenAddress){
        let info;
        if (chainDatabase[chainId].contractAddressToInfoCache[tokenAddress.toUpperCase()]){
            info = chainDatabase[chainId].contractAddressToInfoCache[tokenAddress.toUpperCase()]
        } else {
            const tokenContract = new ethers.Contract(tokenAddress, ethersBase.AbiLibrary.erc20Token, provider);
            const fields = ['symbol', 'name', 'decimals'];
            const [symbol, name, decimals] = await Promise.all(fields.map(field => sendOne(tokenContract, field)));
            info = {symbol, name, decimals, address:tokenAddress, comparatorAddressToPairInfo: {}};
            chainDatabase[chainId].contractAddressToInfoCache[tokenAddress.toUpperCase()] = info;
            writeOutContractAddressToInfoCache();
        }
        return info;
    }

    async function sendOne(obj, functionName, ...args){
        const remainingRequests = await limiter.removeTokens(1);
        //console.log('sending', functionName);
        return obj[functionName](...args);
    }

    async function getBalance({walletAddress, tokenAddress}){
        if (!tokenAddress){
            tokenAddress = nativeToken.address;
        }
        const info = await getTokenInfoByAddress(tokenAddress);

        let balanceBigNumber = BigNumber.from(0);
        if (util.isHexEqual(info.address, nativeToken.address)){
            balanceBigNumber = await sendOne(provider, 'getBalance', walletAddress);
        }
        const tokenContract = new ethers.Contract(tokenAddress, ethersBase.AbiLibrary.erc20Token, provider);
        balanceBigNumber = balanceBigNumber.add(await sendOne(tokenContract, 'balanceOf', walletAddress));

        const rational = bigRational(balanceBigNumber).divide(bigRational('10').pow(info.decimals));
        const string = util.formatRational(rational, info.decimals);
        return {rational, string};
    }

    async function estimateMinimumGasLimit(contract, ...args){
        let gasLimit;
        if (args[0] === 'sendTransaction'){
            console.log('uh oh');
            //provider.estimateGas( transaction ) ⇒ Promise< BigNumber >
            gasLimit = await sendOne(contract, 'estimateGas', args[1], );
        } else {
            //contract.estimateGas.METHOD_NAME( ...args [ , overrides ] ) ⇒ Promise< BigNumber >
            gasLimit = await sendOne(contract.estimateGas, ...args);
        }
        return gasLimit;
    }


    async function sendTransaction(contract, ...args){
        if (args[args.length - 1].gasPrice || args[args.length - 1].maxPriorityFeePerGas){
            //We need to sert the gas LIMIT if we've set the gas PRICE
            if (args[0] === 'sendTransaction'){
                //provider.estimateGas( transaction ) ⇒ Promise< BigNumber >
                const gasEstimate = await sendOne(contract, 'estimateGas', args[1]);
                args[args.length - 1].gasLimit = gasEstimate.mul(2); //estimate may not be sufficient because evm state changes
            } else {
                //contract.estimateGas.METHOD_NAME( ...args [ , overrides ] ) ⇒ Promise< BigNumber >
                const gasEstimate = await sendOne(contract.estimateGas, ...args);
                args[args.length - 1].gasLimit = gasEstimate.mul(2);//estimate may not be sufficient because evm state changes
            }
        }
        return sendOne(contract, ...args);
    }

    async function sendCustomData({privateKey, toAddress, data, value, gasPercentModifier, maxGasPriceGwei}){
        const wallet = new ethers.Wallet(privateKey, endpoint.provider);
        const nonceManagerProvider = getNonceManagerProvider(wallet);

        let gasPercentModifierString = gasPercentModifier ? `${gasPercentModifier}` : undefined;
        let maxGasPriceGweiString = maxGasPriceGwei ? `${maxGasPriceGwei}` : undefined;
        const tx = await checkGasPriceConstraint(endpoint, gasPercentModifierString, maxGasPriceGweiString);
        tx.from = wallet.address;
        tx.to = toAddress;
        tx.value =  value ? ethers.utils.parseEther(value.toString()) : undefined;
        tx.data = data;

        const transactionResponse = await sendOne(nonceManagerProvider, 'sendTransaction', tx);
        log(`Transaction ${transactionResponse.hash} sent - awaiting confirmation...`);
        const transactionReceipt = await waitForTransaction(endpoint, transactionResponse);
        log('OK! TX: ' + transactionReceipt.transactionHash);

        return {
            transactionHash: transactionReceipt.transactionHash,
            ...(await getGasFeeSpent(endpoint, transactionResponse, transactionReceipt))
        }
    }

    async function sendCustomDataString({privateKey, toAddress, string, value}){
        return sendCustomData({privateKey, toAddress, data: ethers.utils.hexlify(ethers.utils.toUtf8Bytes(string)), value})
    }


    const endpoint = {
        provider,
        chainId,
        chainName,
        nativeToken,
        blockExplorerURL,
        sendCustomData,
        sendCustomDataString,
        getRecommendedGasGwei,
        getTokenInfoByAddress,
        sendOne,
        estimateMinimumGasLimit,
        sendTransaction,
        getBalance,
        transfer: async function({privateKey, toWalletAddress, tokenAddress, quantity, gasPercentModifier, maxGasPriceGwei}){
            tokenAddress = resolveTokenAddressFromNickname(endpoint, tokenAddress);
            return transfer({endpoint, privateKey, toWalletAddress, tokenAddress, quantity, gasPercentModifier, maxGasPriceGwei});
        },
        generalContractCall: async function({contractAddress, abiFragment, functionArgs, privateKey, valueField, gasPercentModifier, maxGasPriceGwei}){
            return generalContractCall({endpoint, contractAddress, abiFragment, functionArgs, privateKey, valueField, gasPercentModifier, maxGasPriceGwei});
        },
        createTracker: async function({tokenAddress, comparatorAddress, comparatorIsFiat, exchange, quoteTokenQuantity, pollIntervalSeconds}){
            if (!exchange){
                exchange = defaultExchange;
            }
            if (!comparatorAddress){
                comparatorAddress = nativeTokenAddress;
            }

            tokenAddress = resolveTokenAddressFromNickname(endpoint, tokenAddress);
            comparatorAddress = resolveTokenAddressFromNickname(endpoint, comparatorAddress);
            
            if (comparatorIsFiat === undefined){
                if (ethersBase.chains[chainName].fiatAddresses.some(address => util.isHexEqual(comparatorAddress, address))){
                    comparatorIsFiat = true;
                }
            }

            return createTracker({endpoint, exchange, tokenAddress, comparatorAddress, comparatorIsFiat, quoteTokenQuantity,pollIntervalSeconds});
        },
        addContractEventListener: function({contractAddress, abiFragment, listener}){
            return addContractEventListener({endpoint, contractAddress, abiFragment, listener})
        },
        removeContractEventListener: function({contractAddress, abiFragment, listener}){
            return removeContractEventListener({endpoint, contractAddress, abiFragment, listener})
        },
        addLogListener: function({logFilter, listener}){
            return addLogListener({endpoint, logFilter, listener});
        },
        removeLogListener: function({logFilter, listener}){
            return removeLogListener({endpoint, logFilter, listener});
        },
        nativeToFiatTracker: null,
    }

    if (!omitNativeTokenTrackerInit){
        endpoint.nativeToFiatTracker = await endpoint.createTracker({
            tokenAddress: nativeToken.address,
            comparatorAddress: fiatToken.address,
            comparatorIsFiat: true,
        });
    }
    

    console.log('Endpoint added.');

    return endpoint;
}







function getUplinkTrackers(tracker){
    const uplinkTrackers = [];
    const uplinkTrackerIds = chainDatabase[tracker.chainId].tokenAddressToTrackerIds[tracker.comparator.address];
    if (uplinkTrackerIds){
        for (const trackerId of uplinkTrackerIds){
            uplinkTrackers.push(trackerDatabase[trackerId].tracker);
        }
    }
    return uplinkTrackers;
}


async function getQuoteInComparatorRational(tracker){
    return (await getQuote({tracker})).comparatorPerTokenRational;
}



function resolveTokenAddressFromNickname(endpoint, nickname){
    if (nickname === 'nativeToken'){
        return endpoint.nativeToken.address;
    } else {
        for (const symbol of Object.keys(ethersBase.chains[endpoint.chainName].tokenAddresses)){
            if (nickname === symbol){
                return ethersBase.chains[endpoint.chainName].tokenAddresses[symbol];
            }
        }
    }
    return nickname;
}


async function createTracker({endpoint, exchange, tokenAddress, comparatorAddress, comparatorIsFiat, quoteTokenQuantity,pollIntervalSeconds}){
    comparatorAddress = comparatorAddress ? comparatorAddress : endpoint.nativeToken.address;
    comparatorIsFiat = !!comparatorIsFiat;
    quoteTokenQuantity = quoteTokenQuantity ? quoteTokenQuantity : 1;
    pollIntervalSeconds = pollIntervalSeconds ? pollIntervalSeconds : 10;

    const contractAddressToInfoCache = chainDatabase[endpoint.chainId].contractAddressToInfoCache;

    log('Resolving token and comparator info...');
    let token, comparator, pair;
    for (const cachedInfo of Object.values(contractAddressToInfoCache)){
        if (util.isHexEqual(tokenAddress, cachedInfo.address)){
            token = {decimals: cachedInfo.decimals, symbol: cachedInfo.symbol, name: cachedInfo.name, address: cachedInfo.address};
            if (cachedInfo.comparatorAddressToPairInfo[comparatorAddress]){
                pair = {...cachedInfo.comparatorAddressToPairInfo[comparatorAddress]};
            }
        } else if (util.isHexEqual(comparatorAddress, cachedInfo.address)){
            comparator = {decimals: cachedInfo.decimals, symbol: cachedInfo.symbol, name: cachedInfo.name, address: cachedInfo.address};
        } 
    }
    
    const tokenContract = new ethers.Contract(tokenAddress, ethersBase.AbiLibrary.erc20Token, endpoint.provider);
    const comparatorContract = new ethers.Contract(comparatorAddress, ethersBase.AbiLibrary.erc20Token, endpoint.provider);
    let pairContract;
    const sendOne = endpoint.sendOne;
    const fields = ['symbol', 'name', 'decimals']; 
    await Promise.all([
        (async () => {
            if (!token){ 
                const [symbol, name, decimals] = await Promise.all(fields.map(field => sendOne(tokenContract, field)));
                token = {symbol, name, decimals, address: tokenAddress};
            }
        })(),
        (async () => {
            if (!comparator){
                const [symbol, name, decimals] = await Promise.all(fields.map(field => sendOne(tokenContract, field)));
                comparator = {symbol, name, decimals, address: comparatorAddress};
            }
        })(),
        (async () => {
            if (pair){
                pairContract = new ethers.Contract(pair.address, exchange.AbiSet.pair,  endpoint.provider);
            }
            if (!pair){
                const factoryContract = new ethers.Contract(exchange.factoryAddress, exchange.AbiSet.factory,  endpoint.provider);
                const pairAddress = await sendOne(factoryContract, 'getPair', tokenAddress, comparatorAddress);
                pairContract = new ethers.Contract(pairAddress, exchange.AbiSet.pair,  endpoint.provider);
                const [token0, decimals] =  await Promise.all([sendOne(pairContract, 'token0'), sendOne(pairContract, 'decimals')]);
                pair = {
                    decimals, 
                    comparatorIsToken1: util.isHexEqual(token0, tokenAddress),
                    comparatorIsFiat,
                    address: pairAddress
                };
            }
        })()
    ]);

    let isChainDatabaseDirty = false;
    [token, comparator].map(info => {
        if (!contractAddressToInfoCache[info.address.toUpperCase()]){
            contractAddressToInfoCache[info.address.toUpperCase()] = {...info, comparatorAddressToPairInfo: {}};
            isChainDatabaseDirty = true;
        }
    });
    if (!contractAddressToInfoCache[tokenAddress.toUpperCase()].comparatorAddressToPairInfo[comparatorAddress.toUpperCase()]){
        contractAddressToInfoCache[tokenAddress.toUpperCase()].comparatorAddressToPairInfo[comparatorAddress.toUpperCase()] = {...pair};
        isChainDatabaseDirty = true
    }
    if (!contractAddressToInfoCache[comparatorAddress.toUpperCase()].comparatorAddressToPairInfo[tokenAddress.toUpperCase()]){
        const invertedPairInfo = {...pair};
        invertedPairInfo.comparatorIsToken1 = !invertedPairInfo.comparatorIsToken1;
        contractAddressToInfoCache[comparatorAddress.toUpperCase()].comparatorAddressToPairInfo[tokenAddress.toUpperCase()] = invertedPairInfo;
        isChainDatabaseDirty = true;
    }
    if (isChainDatabaseDirty){
        writeOutContractAddressToInfoCache();
    }

    const trackerPrivate = {
        endpoint,
        exchange,
        tokenContract,
        comparatorContract,
        pairContract,
        swapEventFilter: {
            address: [pair.address],
            topics: [SWAP_FILTER_HASHED]
        },
        swapHandler: async (log) => {
            let parsedLog = await getParsedSwapLog(tracker, log);
            if (!parsedLog){
                return;
            }
        
            let transactionURL = trackerPrivate.endpoint.blockExplorerURL;
            if (transactionURL){
                if (!transactionURL.endsWith('/')){
                    transactionURL += '/';
                }
                transactionURL += `tx/${parsedLog.transactionHash}`;
            }
        
            common.processTrade({
                tracker,
                action: parsedLog.action,
                timestamp: Date.now(),//not real timestamp, which would involve getting the block data
                tokenQuantityRational: parsedLog.tokenQuantity.rational,
                comparatorQuantityRational: parsedLog.comparatorQuantity.rational,
                extraProperties: {
                    parsedLog,
                    transactionURL
                }
            });
        },
    };

    log(`OK. Adding ${token.symbol}-${comparator.symbol} pair...`);

    const tracker = await common.createTrackerObject({
        backendName: 'ethers',
        token, comparator, pair,
        isEqualTo: ({token, comparator}) => {
            token = resolveTokenAddressFromNickname(trackerPrivate.endpoint, token);
            comparator = resolveTokenAddressFromNickname(trackerPrivate.endpoint, comparator);
            return util.isHexEqual(token, tokenAddress) && util.isHexEqual(comparator, comparatorAddress);
        },
        refreshSwapStream: (tracker, turnOn) => {
            if (turnOn){
                trackerPrivate.endpoint.provider.addListener(trackerPrivate.swapEventFilter, trackerPrivate.swapHandler);
            } else {
                trackerPrivate.endpoint.provider.removeListener(trackerPrivate.swapEventFilter, trackerPrivate.swapHandler);
            }            
        }, 
        getQuoteInComparatorRational,
        getUplinkTrackers,
        processBeforeFirstPriceUpdate: (tracker) => {
            trackerDatabase[tracker.id] = {tracker, trackerPrivate};
            if (!chainDatabase[endpoint.chainId].tokenAddressToTrackerIds[tokenAddress]){
                chainDatabase[endpoint.chainId].tokenAddressToTrackerIds[tokenAddress] = [];
            }
            chainDatabase[endpoint.chainId].tokenAddressToTrackerIds[tokenAddress].push(tracker.id);
            chainDatabase[endpoint.chainId].trackerIds.push(tracker.id);
        },
        extraProperties: {
            chainId: endpoint.chainId,

            
        }
    });
    
    log(`${token.symbol}-${comparator.symbol} pair added.`);
    return tracker;
}









async function getQuote({tracker, tokenQuantity}){
    if (!tokenQuantity){
        tokenQuantity = 1;
    }
    const trackerPrivate = trackerDatabase[tracker.id].trackerPrivate;
    if (!tracker.backend === 'ethers'){
        throw Error('Incorrect tracker type for ethers getQuote:', tracker.type);
    }
    const token0Decimals = tracker.pair.comparatorIsToken1 ? tracker.token.decimals : tracker.comparator.decimals;
    const token1Decimals = tracker.pair.comparatorIsToken1 ? tracker.comparator.decimals : tracker.token.decimals;
    const reserves = await trackerPrivate.endpoint.sendOne(trackerPrivate.pairContract, 'getReserves');
    const reserve0AsRational = bigRational(reserves[0].toString()).divide(bigRational('10').pow(token0Decimals));
    const reserve1AsRational = bigRational(reserves[1].toString()).divide(bigRational('10').pow(token1Decimals));
    const reserveTokenRational = tracker.pair.comparatorIsToken1 ? reserve0AsRational : reserve1AsRational;
    const reserveComparatorRational = tracker.pair.comparatorIsToken1 ? reserve1AsRational : reserve0AsRational;
    return {
        reserveTokenRational,
        reserveComparatorRational,
        tokenPerComparatorRational: reserveComparatorRational.isZero() ? bigRational.zero : reserveTokenRational.divide(reserveComparatorRational),
        comparatorPerTokenRational: reserveComparatorRational.isZero() ? bigRational.zero : reserveComparatorRational.divide(reserveTokenRational),
        //Math is the same as what the "quote" function in routers do
        quoteRational: (reserveComparatorRational.multiply(tokenQuantity)).divide(reserveTokenRational.add(tokenQuantity))

    }
}





//returns null if the transaction should be ignored (very low volume trade or invalid log)
async function getParsedSwapLog(tracker, log, ignoreWhenFiatValueUnder=0.01){
    const trackerPrivate = trackerDatabase[tracker.id].trackerPrivate;
    //we shouldn't need this because the filter should... work... but I was getting a javascript runtime error because 
    //this also catches sync events. Not sure whether we should handle those and update prices here but
    // interface.parseLog fails as is so for now, let's just forget about them
    if (!log || !log.topics || !log.topics.includes(SWAP_FILTER_HASHED)){
        return null;
    }
    const parsedLog = trackerPrivate.pairContract.interface.parseLog(log);
    if (!parsedLog){
        return null;
    }

    let wasBuy;
    let tokenQuantityBigNumber;
    let comparatorQuantityBigNumber;
    if (tracker.pair.comparatorIsToken1){
        wasBuy = !parsedLog.args.amount1In.isZero();
        tokenQuantityBigNumber = wasBuy ? parsedLog.args.amount0Out : parsedLog.args.amount0In;
        comparatorQuantityBigNumber = wasBuy ? parsedLog.args.amount1In : parsedLog.args.amount1Out;
    } else {
        wasBuy = !parsedLog.args.amount0In.isZero();
        tokenQuantityBigNumber = wasBuy ? parsedLog.args.amount1Out : parsedLog.args.amount1In;
        comparatorQuantityBigNumber = wasBuy ? parsedLog.args.amount0In : parsedLog.args.amount0Out;
    } 

    const tokenQuantityRational = bigRational(tokenQuantityBigNumber.toString()).divide(bigRational('10').pow(tracker.token.decimals));
    const comparatorQuantityRational = bigRational(comparatorQuantityBigNumber.toString()).divide(bigRational('10').pow(tracker.comparator.decimals));
    const tradeDetails = await common.deriveTradeDetails({
        tokenQuantityString: util.formatRational(tokenQuantityRational, tracker.token.decimals),
        comparatorQuantityString: util.formatRational(comparatorQuantityRational, tracker.comparator.decimals),
        comparatorDecimals: tracker.comparator.decimals,
        possibleTrackers: [tracker]
    })
    
    //we ignore transactions less than 1 cent because low-volume transactions yield outlier results in defi
    //1 cent seems fine, but if you notice it still, up it to like 10 cents or whatever.
    if (tradeDetails.fiatQuantity.string && Number(tradeDetails.fiatQuantity.string) < ignoreWhenFiatValueUnder){ 
        return null;
    }
   
    return {
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        action: wasBuy ? "BUY" : "SELL", 
        ...tradeDetails
    };
}



function getNonceManagerProvider(wallet){
    return new NonceManager(wallet);
}


//throws if maxGasPriceGweiString and gas price exceeds it
//returns overrides for transaction
/*
    if network supports EIP-1559, the gasPercentModifierString is a % of the priority fee, otherwise % of the gas price
    if network supports EIP-1559, the maxGasPriceGweiString is 2*baseFee+priorityFee, otherwise it is of the maxGasPriceGweiString
*/
async function checkGasPriceConstraint(endpoint, gasPercentModifierString, maxGasPriceGweiString){
    if (gasPercentModifierString === undefined){
        gasPercentModifierString = '100%';
    }
    if (maxGasPriceGweiString === undefined){
        maxGasPriceGweiString = '';
    }

    const overrides = {};
    if (maxGasPriceGweiString !== '' || gasPercentModifierString !== ''){
        log('Retrieving gas estimate...');
        
        const feeData =  await endpoint.sendOne(endpoint.provider, 'getFeeData');
        //console.log(feeData);
        if (feeData.maxPriorityFeePerGas){

            const recommendedPriorityFeeStringGwei = ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, 'gwei');
            log(`Recommended gas priority fee per gas: ${recommendedPriorityFeeStringGwei}`);
            let priorityFeeStringGwei;
            if (gasPercentModifierString){
                gasPercentModifierString = util.trim(gasPercentModifierString, '%');
                priorityFeeStringGwei = bigRational(recommendedPriorityFeeStringGwei).multiply(bigRational(gasPercentModifierString).divide(100)).toDecimal(endpoint.nativeToken.decimals);
                log(`Calculated priority fee per gas: ${gasPercentModifierString}% of ${recommendedPriorityFeeStringGwei} = ${priorityFeeStringGwei}`);
            } else {
                priorityFeeStringGwei = recommendedPriorityFeeStringGwei
                log(`Calculated priority fee per gas: recommended = ${priorityFeeStringGwei}`);
            }
           
            
            const recommendedMaxFeeStringGwei = ethers.utils.formatUnits(feeData.maxFeePerGas, 'gwei');
            //log(`Recommended max fee per gas: ${recommendedMaxFeeStringGwei}`);
            let maxFeeStringGwei;
            if (maxGasPriceGweiString){
                maxFeeStringGwei = maxGasPriceGweiString;
            } else {
                const recBaseFeePerGasRat = bigRational(recommendedMaxFeeStringGwei).minus(recommendedPriorityFeeStringGwei).add(priorityFeeStringGwei);
                maxFeeStringGwei = recBaseFeePerGasRat.toDecimal(endpoint.nativeToken.decimals);
            }
            log(`Max fee per gas: ${maxFeeStringGwei}`);
            //2 x base fee + priority fee is generally given as a good rule of thumb max
            const max = bigRational(recommendedMaxFeeStringGwei).minus(recommendedPriorityFeeStringGwei).add(priorityFeeStringGwei);
            if (max.greater(maxFeeStringGwei)){
                throw Error(`2 x base fee + priority fee (${max.toDecimal(endpoint.nativeToken.decimals)}) is < max fee per gas (${maxFeeStringGwei})`)
            }

            overrides.maxFeePerGas = BigNumber.from(bigRational(maxFeeStringGwei).multiply(bigRational('10').pow(9)).toDecimal(0));
            overrides.maxPriorityFeePerGas = BigNumber.from(bigRational(priorityFeeStringGwei).multiply(bigRational('10').pow(9)).toDecimal(0));

        } else {
            const recommendedGasPerUnitBigNumber = feeData.gasPrice;
            const recommendedGasPerUnitStringGwei = ethers.utils.formatUnits(recommendedGasPerUnitBigNumber, 'gwei');
            log(`Recommended gas price: ${recommendedGasPerUnitStringGwei}`);
            const recommendedGasPerUnitGweiRational = bigRational(recommendedGasPerUnitStringGwei);

            const maxGasFeeRationalGwei = maxGasPriceGweiString !== '' ? bigRational(maxGasPriceGweiString) : null;
            if (maxGasPriceGweiString !== '' && gasPercentModifierString === ''){           
            if (recommendedGasPerUnitGweiRational.greater(maxGasFeeRationalGwei)){
                    log(`Gas price: ${recommendedGasPerUnitStringGwei} gwei 🞪`);
                    throw Error(`Recommended gas price exceeds maximum (${util.formatRational(recommendedGasPerUnitGweiRational, endpoint.nativeToken.decimals)} > ${util.formatRational(maxGasFeeRationalGwei, endpoint.nativeToken.decimals)}). Transaction cancelled`);
                } 
            }
            let gasPriceToUseGweiRational = recommendedGasPerUnitGweiRational;
            
            if (gasPercentModifierString !== ''){
                if (gasPercentModifierString.endsWith('%')){
                    const customGasPriceRationalGwei = bigRational(gasPercentModifierString.slice(0,-1));
                    //note you can set lower gas than recommended by giving a % less than 100
                    //if maxGasFeeRationalGwei is lower than result, just the use maxGasFeeRationalGwei (know it's higher than recommended
                    //at least)
                    gasPriceToUseGweiRational =  recommendedGasPerUnitGweiRational.multiply(customGasPriceRationalGwei.divide(100));
                    if (maxGasFeeRationalGwei && maxGasFeeRationalGwei.lesser(gasPriceToUseGweiRational)){
                        gasPriceToUseGweiRational = maxGasFeeRationalGwei
                        log(`Custom gas price as percentage exceeds maximum but maximum is higher than recommended. Using maximum: ${util.formatRational(maxGasFeeRationalGwei, endpoint.nativeToken.decimals)}`);
                        log(`Gas price: ${util.formatRational(gasPriceToUseGweiRational, endpoint.nativeToken.decimals)} gwei ✓`);
                    } else {
                        log(`Using custom gas: ${gasPercentModifierString} of ${util.formatRational(recommendedGasPerUnitGweiRational, endpoint.nativeTokenAddress)}`);
                        log(`Gas price: ${util.formatRational(gasPriceToUseGweiRational, endpoint.nativeToken.decimals)} gwei ✓`);
                    }
                } else {
                    const customGasPriceRationalGwei = bigRational(gasPercentModifierString);
                    if (maxGasFeeRationalGwei && customGasPriceRationalGwei.greater(maxGasFeeRationalGwei)) {
                        log(`Gas price: ${recommendedGasPerUnitStringGwei} gwei 🞪`);
                        throw Error(`Custom gas price exceeds maximum (${util.formatRational(customGasPriceRationalGwei, endpoint.nativeToken.decimals)} > ${util.formatRational(maxGasFeeRationalGwei, endpoint.nativeToken.decimals)}). Transaction cancelled`);
                    }
                    log(`Using custom gas: ${gasPercentModifierString}`);
                    if (recommendedGasPerUnitGweiRational.greater(customGasPriceRationalGwei)){
                        log(`Gas price: ${gasPercentModifierString} gwei 🞪 (may revert)`);
                    } else {
                        log(`Gas price: ${gasPercentModifierString} gwei ✓`);
                    }
                    gasPriceToUseGweiRational = customGasPriceRationalGwei;
                }
            } else {
                log(`Gas price: ${recommendedGasPerUnitStringGwei} gwei ✓`);
            }

            //nine decimals to go from gwei(9) to wei(0)
            overrides.gasPrice = BigNumber.from(gasPriceToUseGweiRational.multiply(bigRational('10').pow(9)).toDecimal(0));
        }
    }
    return overrides;
}


/*
This is a workaround for https://github.com/ethers-io/ethers.js/issues/945
where tx.wait() hangs if tx is dropped from mempool.
So we also poll for that case (idea thanks to https://github.com/ethers-io/ethers.js/issues/945#issuecomment-1047428066)
*/
async function waitForTransaction(endpoint, transactionResponse){
    let finished = false;
    const result = await Promise.race([
        (async () => {
            const transactionReceipt = await transactionResponse.wait();
            if (finished){ return; }
            if (transactionReceipt.hasOwnProperty('status') && transactionReceipt.status === 0){
                throw Error("Transaction reverted: " + JSON.stringify(transactionReceipt));
            }
            return transactionReceipt;
        })(),
        (async () => {
            while (!finished) {
                await util.awaitMs(3000);
                if (finished){ return; }
                const mempoolTxResponse = await endpoint.sendOne(endpoint.provider, 'getTransaction', transactionResponse.hash);
                if (finished){ return; }
                if (!mempoolTxResponse){
                    return null;
                } else if (mempoolTxResponse.confirmations > 0){
                    const transactionReceipt = await mempoolTxResponse.wait();
                    if (finished){ return; }
                    if (transactionReceipt.hasOwnProperty('status') && transactionReceipt.status === 0){
                        throw Error("Transaction reverted: " + JSON.stringify(transactionReceipt));
                    }
                    console.log('returned mempool tx')
                    return transactionReceipt;
                }
            }
        })()
    ]);
    finished = true;
    if (!result){
        throw Error(`Transaction ${transactionResponse.hash} failed`);
    }
    return result;
}

async function checkAllowance({endpoint, wallet, addressToAllow, tokenAddress, requiredAmount}){
    if (tokenAddress.toUpperCase() !== endpoint.nativeToken.address.toUpperCase()){//no need for approval to spend native wrapped token
        const tokenContract = new ethers.Contract(tokenAddress, ethersBase.AbiLibrary.erc20Token, wallet);
        const approvedAmountBigNumber = await endpoint.sendOne(tokenContract, 'allowance', wallet.address, addressToAllow);
        if (approvedAmountBigNumber.lt(requiredAmount)){
            //console.log(tokenAddress, wallet.address, addressToAllow, approvedAmountBigNumber.toString(), requiredAmount.toString());
            log(`Approving ${tokenAddress} for router ${addressToAllow}`);
            const tx = await endpoint.sendOne(tokenContract, 'approve', addressToAllow, ethers.constants.MaxUint256);
            await waitForTransaction(endpoint, tx);
            log("Router approved");
        }
    }
}

async function getGasFeeSpent(endpoint, transactionResponse, transactionReceipt){
    const gasPriceBigNumber = (await endpoint.sendOne(endpoint.provider, 'getTransaction', transactionResponse.hash)).gasPrice;
    const gasFeeWeiRational = bigRational(ethers.utils.formatEther(gasPriceBigNumber.mul(transactionReceipt.gasUsed)));
    //nine decimals to go from gwei to wei
    const gasFeeWeiString = util.formatRational(gasFeeWeiRational, endpoint.nativeToken.decimals);
    let gasFeeFiatString;
    let gasFeeFiatRational;
    for (const trackerAddress of Object.keys(chainDatabase[endpoint.chainId].tokenAddressToTrackerIds)){
        if (util.isHexEqual(trackerAddress, endpoint.nativeToken.address)){
            const trackerId = chainDatabase[endpoint.chainId].tokenAddressToTrackerIds[trackerAddress];
            const tracker = trackerDatabase[trackerId].tracker;
            gasFeeFiatRational = await common.getFiatQuantityRational({
                tracker, getUplinkTrackers,
                priceRational: bigRational(gasFeeWeiString),
                priceIsInToken: true
            });
            gasFeeFiatString = util.formatRational(gasFeeFiatRational, common.FIAT_DEFAULT_DECIMALS);
        }
    }
    return {gasFeeWeiRational, gasFeeWeiString, gasFeeFiatRational, gasFeeFiatString};
}








//untested - transactions stalling
async function transfer({endpoint, privateKey, toWalletAddress, tokenAddress, quantity, gasPercentModifier, maxGasPriceGwei}){
    let quantityString = `${quantity}`.trim();
    let gasPercentModifierString = gasPercentModifier ? `${gasPercentModifier}` : undefined;
    let maxGasPriceGweiString = maxGasPriceGwei ? `${maxGasPriceGwei}` : undefined;

    const wallet = new ethers.Wallet(privateKey, endpoint.provider);
    const nonceManagerProvider = getNonceManagerProvider(wallet);

    const overrides = await checkGasPriceConstraint(endpoint, gasPercentModifierString, maxGasPriceGweiString);

    const token = await endpoint.getTokenInfoByAddress(tokenAddress);

    let walletBalanceOfExact;
    let exactQuantityRational;
    if (quantityString.endsWith('%')){
        quantityString = util.trim(quantityString, '%');
        walletBalanceOfExact = await endpoint.getBalance({tokenAddress, walletAddress: wallet.address});
        exactQuantityRational = bigRational(quantityString).divide(100).multiply(walletBalanceOfExact.rational);
        log(`${token.symbol} quantity: ${quantityString}% of ${walletBalanceOfExact.string} = ${util.formatRational(exactQuantityRational, token.decimals)}`);
    } else {
        exactQuantityRational = bigRational(quantityString);
        log(`${token.symbol} quantity: ${util.formatRational(exactQuantityRational, token.decimals)}`);
    }
    const exactQuantityBigNumber = BigNumber.from(exactQuantityRational.multiply(bigRational('10').pow(token.decimals)).toDecimal(0));
    const exactString = util.formatRational(exactQuantityRational, token.decimals);

    log(`Sending ${exactString} ${token.symbol} to ${toWalletAddress}`);
    
    let transactionResponse;
    if (util.isHexEqual(tokenAddress, endpoint.nativeToken.address)){
        overrides.to = toWalletAddress;
        overrides.value = exactQuantityBigNumber;
        transactionResponse = await endpoint.sendTransaction(nonceManagerProvider, 'sendTransaction', overrides);
    } else {
        const tokenContract = new ethers.Contract(tokenAddress, ethersBase.AbiLibrary.erc20Token, nonceManagerProvider);
        transactionResponse = await endpoint.sendTransaction(tokenContract, 'transfer', toWalletAddress, exactQuantityBigNumber, overrides);
    }
    
    log(`Transaction ${transactionResponse.hash} sent - awaiting confirmation...`);
    const transactionReceipt = await waitForTransaction(endpoint, transactionResponse);
    log('OK! TX: ' + transactionReceipt.transactionHash);

    return {
        transactionHash: transactionReceipt.transactionHash,
        tokenQuantityIn: exactString,
        ...(await getGasFeeSpent(endpoint, transactionResponse, transactionReceipt))
    }
}





function getAbiAsJson(str){
    if (!str.startsWith(`[`)){
        if (str.startsWith(`{`)){
            str = `[${str}]`;
        } else {
            str =  `["${str}"]`;
        }
    }
    return JSON.parse(new ethers.utils.Interface(str).format(ethers.utils.FormatTypes.json));
}



async function generalContractCall({endpoint, contractAddress, abiFragment, functionArgs, privateKey, valueField, gasPercentModifier, maxGasPriceGwei}){
    let gasPercentModifierString = gasPercentModifier ? `${gasPercentModifier}` : undefined;
    let maxGasPriceGweiString = maxGasPriceGwei ? `${maxGasPriceGwei}` : undefined;
    if (!functionArgs){
        functionArgs = [];
    }
    
    const abiFragmentJSON = getAbiAsJson(abiFragment);
    const functionName = abiFragmentJSON[0].name;
    
    let provider = endpoint.provider;
    let overrides = {};
    if (privateKey){
        provider = getNonceManagerProvider(new ethers.Wallet(privateKey, provider));
        overrides = await checkGasPriceConstraint(endpoint, gasPercentModifierString, maxGasPriceGweiString);
    }

    log(`Function: ${functionName}, args: ${functionArgs}`);
    const functionArgValues = [];
    for (let i = 0; i < functionArgs.length; ++ i){
        let arg = functionArgs[i];
        if (arg !== '' && !isNaN(arg) && !VALID_ERC20_REGEX.test(arg)){
            if (typeof arg !== 'string'){
                arg = arg.toString();
            }
            arg = BigNumber.from(arg.split(".")[0]);
        }
        functionArgValues.push(arg);
    }

    const contract = new ethers.Contract(contractAddress, abiFragmentJSON, provider);

    if (valueField !== null && valueField !== undefined){
        overrides.value = BigNumber.from(valueField);
    }
    let response;
    if (ethers.Signer.isSigner(provider)){
        log(`Sending transaction calling ${functionName}...`);
        response = await endpoint.sendTransaction(contract, functionName, ...functionArgValues, overrides);
    } else {
        log(`Calling read-only function ${functionName}...`);
        response = await contract[functionName](...functionArgValues, overrides);
    }
   
    if (typeof response === 'object' && response.wait && response.nonce && response.hash){
        log('TX: ' + response.hash);
        log('Awaiting confirmation...');
        const transactionReceipt = await waitForTransaction(endpoint, transactionResponse);
        log('OK! TX: ' + transactionReceipt.transactionHash);
        return transactionReceipt.transactionHash;
    } else {
        if (BigNumber.isBigNumber(response)){
            response = response.toString();
        }
        return response;
    }   
}



//apparently contractAddress can be left out to specify any contract, but that doesn't seem to work
//topics  can be left out to specify any topics
//see more about topics in filters here: https://docs.ethers.io/v5/concepts/events/#events--filters
//listener should accept {blockNumber, blockHash, transactionIndex, removed, address, data, topics, transactionHash, logIndex}
async function addLogListener({endpoint, logFilter, listener}){
    const infoKey = JSON.stringify(logFilter);

    //It seems that although contract.off does remove the listener, there may be cached events that still come
    //piling through. This is a workaround to let the internalListener know directly whether to proceed. 
    const workaroundFuse = {isOn: true};

    function internalListener(result){
        if (!workaroundFuse.isOn){
            return;
        }
        //workaround for (I think) syncs triggering filters despite not containing the topic
        if (logFilter.topics){
            let hasTopic;
            for (const topic of result.topics){
                if (logFilter.topics.includes(topic)){
                    hasTopic = true;
                    break;
                }
            }
            if (!hasTopic){
                return;
            }
        }
        //log(`Log fired: ${infoKey}`); 
        listener(result);
    };

    if (!chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey]){
        chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey] = new Map();
    }
    if (!chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey].has(listener)){
        chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey].set(listener, 
            {internalListener, infoKey, workaroundFuse}
        )
        log(`Listener added for ${infoKey}`);
        endpoint.provider.on(logFilter, internalListener);
    }
}


async function removeLogListener({endpoint, logFilter, listener}){
    const infoKey = JSON.stringify(logFilter);
    
    if (chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey]
    && chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey].has(listener)){
        const registeredEvent = chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey].get(listener);
        endpoint.provider.off(logFilter, registeredEvent.internalListener);
        registeredEvent.workaroundFuse.isOn = false;
        chainDatabase[endpoint.chainId].eventFilterToRegisteredEvents[infoKey].delete(listener);
        //log(`Listener removed for ${infoKey}`);
    }
}

/* 
function getLogFilter({contractAddress, topics, topicsAreAlreadyHashed}){
    let topicHashes = null;
    if (topics){
        if (topicsAreAlreadyHashed){
            topicHashes = topics;
        } else {
            topicHashes = [];
            for (const topic of topics){
                if (typeof topic === 'array'){
                    const innerArray = [];
                    for (const innerTopic of topic){
                        if (innerTopic){
                            innerArray.push(ethers.utils.id(innerTopic));
                        } else {
                            innerArray.push(null);
                        }
                    }
                    topicHashes.push(innerArray);
                } else {
                    if (topic){
                        topicHashes.push(ethers.utils.id(topic));
                    } else {
                        topicHashes.push(null);
                    }
                }
            }
        } 
    }
    return {
        address: contractAddress ? [contractAddress] : [null],
        topics: topicHashes
    }
}
 */


function addContractEventListener({endpoint, contractAddress, abiFragment, listener}){
    const abiFragmentJSON = getAbiAsJson(abiFragment);
    const eventName = abiFragmentJSON[0].name;
    const contract = new ethers.Contract(contractAddress, abiFragmentJSON, endpoint.provider);
    
    //It seems that although contract.off does remove the listener, there may be cached events that still come
    //piling through. This is a workaround to let the internalListener know directly whether to proceed. 
    const workaroundFuse = {isOn: true};

    function internalListener(...parameters){
        
        if (!workaroundFuse.isOn){
            return;
        }
        const log = parameters[parameters.length-1];
        let result = {log};
        for (let i = 0; i < abiFragmentJSON[0].inputs.length; ++i){
            const name = abiFragmentJSON[0].inputs[i].name;
            result[name] = BigNumber.isBigNumber(parameters[i]) ? parameters[i].toString() : parameters[i];
        }
        //log('Event fired:', eventName);
        listener(result);
    };
    if (!chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress]){
        chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress] = {}
    }
    if (!chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName]){
        chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName] = new Map();
    }
    if (!chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName].has(listener)){
        chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName].set(listener, 
            {internalListener, eventName, contract, workaroundFuse}
        )
        log(`Listener added for ${contractAddress}.${eventName}`);
        contract.on(eventName, internalListener);
    }
}

function removeContractEventListener({endpoint, contractAddress, abiFragment, listener}){
    const abiFragmentJSON = getAbiAsJson(abiFragment);
    const eventName = abiFragmentJSON[0].name;
    if (chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress]
    && chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName]
    && chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName].has(listener)){
        const registeredEvent = chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName].get(listener);
        registeredEvent.contract.off(eventName, registeredEvent.internalListener);
        registeredEvent.workaroundFuse.isOn = false;
        chainDatabase[endpoint.chainId].contractAddressToRegisteredEvents[contractAddress][eventName].delete(listener);
        log(`Listener removed for ${contractAddress}.${eventName}`);
    }
}

function createWalletFromPrivateKey({privateKey}){
    return new ethers.Wallet(privateKey);
}

function createRandomWallet(options){
    return ethers.Wallet.createRandom(options);
}









































const UniswapV2 = (() =>{
    async function swapUniswapV2({tracker, privateKey, method, exactQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei, justReturnEstimatedGasFee}){
        if (!timeoutSecs){
            timeoutSecs = 5 * 60;
        }
        let quantityString = `${exactQuantity}`.trim();
        let slippagePercentString = `${slippagePercent}`;
        let gasPercentModifierString = gasPercentModifier ? `${gasPercentModifier}` : undefined;
        let maxGasPriceGweiString = maxGasPriceGwei ? `${maxGasPriceGwei}` : undefined;
    
        const trackerPrivate = trackerDatabase[tracker.id].trackerPrivate;
        const isBuy = method === 'buyTokensWithExact' || method == 'buyExactTokens';
    
        const wallet = new ethers.Wallet(privateKey, trackerPrivate.endpoint.provider);
        const nonceManagerProvider = getNonceManagerProvider(wallet);
        const routerContract = new ethers.Contract(
            trackerPrivate.exchange.routerAddress, trackerPrivate.exchange.AbiSet.router, nonceManagerProvider
        );
        
        const overrides = await checkGasPriceConstraint(trackerPrivate.endpoint, gasPercentModifierString, maxGasPriceGweiString);
    
        const route = isBuy ? [tracker.comparator.address, tracker.token.address] : [tracker.token.address, tracker.comparator.address];
        const routeIndexOfExact = method === 'buyTokensWithExact' || method === 'sellExactTokens' ? 0 : route.length-1;
        const routeIndexOfInexact = routeIndexOfExact === 0 ? route.length-1 : 0;
        const infoOfExact = util.isHexEqual(route[routeIndexOfExact], tracker.token.address) ? tracker.token : tracker.comparator;
        const infoOfInexact = infoOfExact === tracker.token ? tracker.comparator : tracker.token;
        
        //exact amount
        let walletBalanceOfExact;
        let exactQuantityRational;
        if (quantityString.endsWith('%') && quantityString.startsWith('-')){
            throw Error("Quantity string cannot both be prepended with '-' and appended with '%'");
        }
        if (quantityString.endsWith('%')){
            quantityString = util.trim(quantityString, '%');
            walletBalanceOfExact = await trackerPrivate.endpoint.getBalance({tokenAddress: infoOfExact.address, walletAddress: wallet.address});
            exactQuantityRational = bigRational(quantityString).divide(100).multiply(walletBalanceOfExact.rational);
            log(`${infoOfExact.symbol} quantity: ${quantityString}% of ${walletBalanceOfExact.string} = ${util.formatRational(exactQuantityRational, infoOfExact.decimals)}`);
        } else if (quantityString.startsWith('-')){
            quantityString = util.trim(quantityString, '-');
            walletBalanceOfExact = await trackerPrivate.endpoint.getBalance({tokenAddress: infoOfExact.address, walletAddress: wallet.address});
            exactQuantityRational = walletBalanceOfExact.rational.minus(quantityString);
            log(`${infoOfExact.symbol} quantity: ${walletBalanceOfExact.string} balance - ${quantityString} = ${util.formatRational(exactQuantityRational, infoOfExact.decimals)}`);
        } else {
            exactQuantityRational = bigRational(quantityString);
            log(`${infoOfExact.symbol} quantity: ${util.formatRational(exactQuantityRational, infoOfExact.decimals)}`);
        }

        const exactQuantityBigNumber = BigNumber.from(exactQuantityRational.multiply(bigRational('10').pow(infoOfExact.decimals)).toDecimal(0));
        const exactString = util.formatRational(exactQuantityRational, infoOfExact.decimals);
        if (method === 'buyTokensWithExact' || method === 'sellExactTokens'){
            if (!walletBalanceOfExact){
                walletBalanceOfExact = await trackerPrivate.endpoint.getBalance({tokenAddress: infoOfExact.address, walletAddress: wallet.address});
            }
            if (exactQuantityRational.greater(walletBalanceOfExact.rational)){
                throw Error(`Insufficient ${infoOfExact.symbol} balance`);
            }
        }
    
        //slippage for inexact amount
        slippagePercentString = util.trim(slippagePercentString.trim(), '%');
        let expectedInexactAmountBigNumber;
        if (routeIndexOfExact === 0){
            const amountsOut = await trackerPrivate.endpoint.sendOne(routerContract, 'getAmountsOut', exactQuantityBigNumber, route);
            expectedInexactAmountBigNumber = amountsOut[amountsOut.length - 1];
        } else {
            const amountsIn = await trackerPrivate.endpoint.sendOne(routerContract, 'getAmountsIn', exactQuantityBigNumber, route);
            expectedInexactAmountBigNumber = amountsIn[0];
        } 
        const expectedInexactAmountRational = bigRational(expectedInexactAmountBigNumber).divide(bigRational('10').pow(infoOfInexact.decimals));
        const expectedInexactAmountString = util.formatRational(expectedInexactAmountRational, infoOfInexact.decimals);
    
        let inexactBoundsRational;
        const slippageDeltaRational = bigRational(slippagePercentString).divide(100).multiply(expectedInexactAmountRational);
        if (routeIndexOfExact === 0){
            inexactBoundsRational = expectedInexactAmountRational.minus(slippageDeltaRational);
        } else {
            inexactBoundsRational = expectedInexactAmountRational.plus(slippageDeltaRational);
        }
        const inexactBoundsBigNumber = BigNumber.from(inexactBoundsRational.multiply(bigRational('10').pow(infoOfInexact.decimals)).toDecimal(0));
        const inexactBoundsString = util.formatRational(inexactBoundsRational, infoOfInexact.decimals);
    
        //router allowance
        const addressToSpend = isBuy ? tracker.comparator.address : tracker.token.address;
        const amountToSpendBigNumber = routeIndexOfExact === 0 ? exactQuantityBigNumber : inexactBoundsBigNumber;
        await checkAllowance({
            endpoint: trackerPrivate.endpoint, 
            wallet: wallet, 
            addressToAllow: trackerPrivate.exchange.routerAddress,
            tokenAddress: addressToSpend, 
            requiredAmount: amountToSpendBigNumber
        });
        
        log('Slippage: ' + slippagePercentString + '%');
        const beginning = justReturnEstimatedGasFee ? 'Simulating a swap of' : 'Swapping';
        if (routeIndexOfExact === 0){
            log(`${beginning} exactly ${exactString} ${infoOfExact.symbol} for at least ${inexactBoundsString} ${infoOfInexact.symbol} (expecting ${expectedInexactAmountString})...`);
        } else {
            log(`${beginning} at most ${inexactBoundsString} ${infoOfInexact.symbol} (expecting ${expectedInexactAmountString}) for exactly ${exactString} ${infoOfExact.symbol} ...`);
        }
    
        if (method === 'buyExactTokens' || method === 'sellTokensForExact'){
            const walletBalanceOfInexact = await trackerPrivate.endpoint.getBalance({tokenAddress: infoOfInexact.address, walletAddress: wallet.address});
            if (inexactBoundsRational.greater(walletBalanceOfInexact.rational)){
                throw Error(`Balance of ${infoOfInexact.symbol} (${walletBalanceOfInexact.string}) is insufficient to meet the upper bounds of transaction.`);
            }
        }
    
        const functionToCall = trackerPrivate.endpoint[justReturnEstimatedGasFee ? 'estimateMinimumGasLimit' : 'sendTransaction'];
        //console.log(overrides);
        
        //send transaction
        const deadline = Math.floor(Date.now() / 1000) + timeoutSecs; //deadline is unix timestamp (seconds, not ms)
        let transactionResponse;
        let methodUsed;
        if (routeIndexOfExact === 0 && util.isHexEqual(route[routeIndexOfExact], trackerPrivate.endpoint.nativeToken.address)){
            methodUsed = 'swapExactETHForTokensSupportingFeeOnTransferTokens';
            overrides.value = exactQuantityBigNumber;
            transactionResponse =  await functionToCall(
                routerContract, methodUsed, inexactBoundsBigNumber, route, wallet.address, deadline, 
                overrides
            );
        } else if (routeIndexOfExact === 0 && util.isHexEqual(route[routeIndexOfInexact], trackerPrivate.endpoint.nativeToken.address)){
            methodUsed = 'swapExactTokensForETHSupportingFeeOnTransferTokens';
            transactionResponse = await functionToCall(
                routerContract, methodUsed, exactQuantityBigNumber, inexactBoundsBigNumber, route, wallet.address, deadline, overrides   
            );
        } else if (routeIndexOfExact === route.length-1 && util.isHexEqual(route[routeIndexOfExact], trackerPrivate.endpoint.nativeToken.address)){
            methodUsed = 'swapTokensForExactETHSupportingFeeOnTransferTokens';
            transactionResponse = await functionToCall(
                routerContract, methodUsed, exactQuantityBigNumber, inexactBoundsBigNumber, route, wallet.address, deadline, overrides
            );
        } else if (routeIndexOfExact === route.length-1 && util.isHexEqual(route[routeIndexOfInexact], trackerPrivate.endpoint.nativeToken.address)){
            methodUsed = 'swapETHForExactTokensSupportingFeeOnTransferTokens';
            overrides.value = inexactBoundsBigNumber;
            transactionResponse = await functionToCall(
                routerContract, methodUsed, exactQuantityBigNumber, route, wallet.address, deadline, overrides
            );
        } else {
           
            methodUsed = routeIndexOfExact === 0 ? 'swapExactTokensForTokensSupportingFeeOnTransferTokens' : 'swapTokensForExactTokensSupportingFeeOnTransferTokens';
            transactionResponse = await functionToCall(
                routerContract, methodUsed, exactQuantityBigNumber, inexactBoundsBigNumber, route, 
                wallet.address, deadline, overrides
            );
        }
    
    
        if (justReturnEstimatedGasFee){
            let gasFee;
            if (overrides.gasPrice){
                gasFee = bigRational(overrides.gasPrice.mul(transactionResponse)).divide(bigRational('10').pow(trackerPrivate.endpoint.nativeToken.decimals));
            } else {
                const estimatePerGas = bigRational(overrides.maxFeePerGas).minus(overrides.maxPriorityFeePerGas).divide(2).add(overrides.maxPriorityFeePerGas);
                gasFee = estimatePerGas.multiply(transactionResponse).divide(bigRational('10').pow(trackerPrivate.endpoint.nativeToken.decimals));
            }
            return util.formatRational(gasFee, trackerPrivate.endpoint.nativeToken.decimals);
        }
    
    
        log(`Transaction ${transactionResponse.hash} sent - awaiting confirmation...`);
        const transactionReceipt = await waitForTransaction(trackerPrivate.endpoint, transactionResponse);
        let swapLog;
        for (const log of transactionReceipt.logs){
            if (util.isHexEqual(log.topics[0], SWAP_FILTER_HASHED) && util.isHexEqual(log.address, trackerPrivate.swapEventFilter.address[0])){
                swapLog = log;
                break;
            }
        }
        if (!swapLog){
            throw Error("No swap log found in receipt for swap transaction:" + JSON.stringify(transactionReceipt));
        }
        log('OK! TX: ' + transactionReceipt.transactionHash);
        
        const parsedLog = await getParsedSwapLog(tracker, swapLog, 0);
        log(`${parsedLog.action} ${parsedLog.tokenQuantity.string} ${tracker.token.symbol} FOR ${parsedLog.comparatorQuantity.string} ${tracker.comparator.symbol} ($${parsedLog.fiatQuantity.string})`);
    
        return {
            ...parsedLog,
            ...(await getGasFeeSpent(trackerPrivate.endpoint, transactionResponse, transactionReceipt))
        }
    }
    




    //untested!
    //method === addLiquidity -> pairQuantity not needed
    //method === removeLiquidity -> tokenQuantity and minNativeReserved not needed
    //addLiquidity: Reduces quantities to match comparator balance constraints before slippage is calculated
    async function addOrRemoveliquidityUniswapV2({tracker, privateKey, method, tokenQuantity, pairQuantity, minNativeReserved,
    slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}){
        const trackerPrivate = trackerDatabase[tracker.id].trackerPrivate;
        const endpoint = trackerPrivate.endpoint;
        const {token, comparator, pair} = tracker;
        const wallet = new ethers.Wallet(privateKey, endpoint.provider);
        const nonceManagerProvider = getNonceManagerProvider(wallet);
        const formatRational = util.formatRational;
    
        let gasPercentModifierString = gasPercentModifier ? `${gasPercentModifier}` : undefined;
        let maxGasPriceGweiString = maxGasPriceGwei ? `${maxGasPriceGwei}` : undefined;
        
        const routerContract = new ethers.Contract(
            trackerPrivate.exchange.routerAddress, trackerPrivate.exchange.AbiSet.router, nonceManagerProvider
        );
        const pairContract = trackerPrivate.pairContract;
        const slippageProportionRational = bigRational(slippagePercent).divide(100);
        const [overrides, reserveInfo] = await Promise.all([
            await checkGasPriceConstraint(trackerPrivate.endpoint, gasPercentModifierString, maxGasPriceGweiString),
            await getQuote({tracker}),
        ]);
    
        
        let transactionResponse;
        const retObject = {};
        if (method === 'addLiquidity'){
            let tokenQuantityString = `${tokenQuantity}`.trim();
            let tokenQuantityIsPercentage = false;
            if (tokenQuantityString.endsWith('%')){
                tokenQuantityIsPercentage = true;
                tokenQuantityString = util.trim(tokenQuantityString, '%');
            }
            const minNativeReservedRational = bigRational(minNativeReserved ? minNativeReservedRational : 0);
            const [walletBalanceOfToken, walletBalanceOfComparator] = await Promise.all([
                endpoint.getBalance({tokenAddress: token.address, walletAddress: wallet.address}),
                endpoint.getBalance({tokenAddress: comparator.address, walletAddress: wallet.address})
            ]);
    
            let tokenQuantityRational;
            if (tokenQuantityIsPercentage){
                tokenQuantityRational = bigRational(tokenQuantityString).divide(100).multiply(walletBalanceOfToken.rational);
                log(`${token.symbol} quantity: ${tokenQuantityString}% of ${walletBalanceOfToken.string} = ${util.formatRational(tokenQuantityRational, token.decimals)}`);
            } else {
                tokenQuantityRational = bigRational(tokenQuantityString);
                log(`${token.symbol} quantity: ${util.formatRational(tokenQuantityRational, token.decimals)}`);
            }
            if (util.isHexEqual(token.address, endpoint.nativeToken.address)){
                const leftover = walletBalanceOfToken.rational.minus(tokenQuantityRational);
                if (leftover.lesser(minNativeReservedRational)){
                    tokenQuantityRational = walletBalanceOfToken.rational.minus(minNativeReservedRational);
                    tokenQuantityString = util.formatRational(tokenQuantityRational, token.decimals);
                    if (tokenQuantityRational.isNegative()){
                        throw Error(`${token.symbol} balance is less than required to leave reserved`);
                    } else {
                        log(`${token.symbol} quantity reduced (to leave minimum native reserve): ${tokenQuantityString}`);
                    }
                }
            }
            if (tokenQuantityRational.greater(walletBalanceOfToken.rational)){
                throw Error(`Insufficient ${token.symbol} balance`);
            }
    
            let comparatorQuantityRational = tokenQuantityRational.multiply(reserveInfo.tokenPerComparatorRational);
            log(`${comparator.symbol} quantity: ${formatRational(comparatorQuantityRational, comparator.decimals)}`);
            
            let leftoverComparatorRational = walletBalanceOfComparator.rational.minus(comparatorQuantityRational);
            if (util.isHexEqual(comparator.address, endpoint.nativeToken.address)){
                if (walletBalanceOfComparator.rational.minus(minNativeReservedRational).isNegative()){
                    throw Error(`${comparator.symbol} balance is less than required to leave reserved`);
                }
                leftoverComparatorRational = leftover.minus(minNativeReservedRational);
            }
            if (leftoverComparatorRational.isNegative()){
                const differenceRational = leftoverComparatorRational.abs();
                const differenceProportionRational = differenceRational.divide(comparatorQuantityRational)
                log(`Reducing quantities to match comparator balance constraints...`);
                tokenQuantityRational = tokenQuantityRational.minus(tokenQuantityRational.multiply(differenceProportionRational));
                tokenQuantityString = util.formatRational(tokenQuantityRational, token.decimals);
                comparatorQuantityRational = comparatorQuantityRational.minus(comparatorQuantityRational.multiply(differenceProportionRational));
                log(`${token.symbol} quantity: ${tokenQuantityRational}`);
                log(`${comparator.symbol} quantity: ${formatRational(comparatorQuantityRational, comparator.decimals)}`);
            }
            
            //ok!
            const tokenQuantityBigNumber = BigNumber.from(tokenQuantityRational.multiply(bigRational('10').pow(token.decimals)).toDecimal(0));
            const minTokenQuantityRational = tokenQuantityRational.minus(tokenQuantityRational.multiply(slippageProportionRational));
            const mintokenQuantityBigNumber = BigNumber.from(minTokenQuantityRational.multiply(bigRational('10').pow(token.decimals)).toDecimal(0));
            await checkAllowance({
                endpoint, 
                wallet: wallet, 
                addressToAllow: trackerPrivate.exchange.routerAddress,
                tokenAddress: token.address, 
                requiredAmount: tokenQuantityBigNumber
            });
    
            const comparatorQuantityBigNumber = BigNumber.from(comparatorQuantityRational.multiply(bigRational('10').pow(comparator.decimals)).toDecimal(0));
            const minComparatorQuantityRational = comparatorQuantityRational.minus(comparatorQuantityRational.multiply(slippageProportionRational));
            const minComparatorQuantityBigNumber = BigNumber.from(minComparatorQuantityRational.multiply(bigRational('10').pow(comparator.decimals)).toDecimal(0));
            await checkAllowance({
                endpoint, 
                wallet: wallet, 
                addressToAllow: trackerPrivate.exchange.routerAddress,
                tokenAddress: comparator.address, 
                requiredAmount: comparatorQuantityBigNumber
            });
            
            
            const tokenPart = `${tokenQuantityString} ${token.symbol} (min ${formatRational(minTokenQuantityRational, token.decimals)})`;
            const comparatorPart = `${formatRational(comparatorQuantityRational, comparator.decimals)} ${comparator.symbol} (min ${formatRational(minComparatorQuantityRational, comparator.decimals)})`;
            const intentionStatement = `Adding ${tokenPart} and ${comparatorPart} to liquidity through ${trackerPrivate.exchange.routerAddress}`;
            log(intentionStatement);
    
            //finally, add liquidity
            const deadline = Math.floor(Date.now() / 1000) + Number(timeoutSecs); //deadline is unix timestamp (seconds, not ms)
            if (util.isHexEqual(token.address, endpoint.nativeToken.address)){
                overrides.value = tokenQuantityBigNumber;
                transactionResponse = await endpoint.sendTransaction(routerContract, 'addLiquidityETH', comparator.address, 
                    comparatorQuantityBigNumber, minComparatorQuantityBigNumber,
                    mintokenQuantityBigNumber, wallet.address, deadline, overrides
                )
            } else if (util.isHexEqual(comparator.address, endpoint.nativeToken.address)){
                overrides.value = comparatorQuantityBigNumber;
                transactionResponse = await endpoint.sendTransaction(routerContract, 'addLiquidityETH', token.address, 
                    tokenQuantityBigNumber, mintokenQuantityBigNumber,
                    minComparatorQuantityBigNumber, wallet.address, deadline, overrides
                )
            } else {
                transactionResponse = await endpoint.sendTransaction(routerContract, 'addLiquidityETH', token.address, comparator.address,
                    tokenQuantityBigNumber, comparatorQuantityBigNumber,
                    mintokenQuantityBigNumber, minComparatorQuantityBigNumber,
                    wallet.address, deadline, overrides
                )
            }
    
        } else if (method === 'removeLiquidity') {
            let pairQuantityString = `${pairQuantity}`.trim();
            let pairQuantityIsPercentage = false;
            if (pairQuantityString.endsWith('%')){
                pairQuantityIsPercentage = true;
                pairQuantityString = util.trim(pairQuantityString, '%');
            }
    
            log(`Calculating LP ratio...`);
            const totalPairSupplyBigNumber = await endpoint.sendOne(pairContract, 'totalSupply');
            const totalSupplyRational = bigRational(totalPairSupplyBigNumber.toString()).divide(bigRational('10').pow(pair.decimals));
            const tokenPerLPRational = reserveInfo.reserveTokenRational.divide(totalSupplyRational);
            const comparatorPerLPRational = reserveInfo.reserveComparatorRational.divide(totalSupplyRational);
    
             const walletbalanceOfPair = await endpoint.getBalance({tokenAddress: pair.address, walletAddress: wallet.address})
    
            let pairQuantityRational = bigRational(pairQuantityString);
            if (pairQuantityIsPercentage){
                pairQuantityRational = pairQuantityRational.divide(100).multiply(walletbalanceOfPair.rational);
                log(`${token.symbol} quantity: ${pairQuantityString}% of ${walletbalanceOfPair.string} = ${util.formatRational(pairQuantityRational, pair.decimals)}`);
            } else {
                log(`${pair.symbol} quantity: ${formatRational(pairQuantityRational, pair.decimals)}`);
            }
            pairQuantityString = formatRational(pairQuantityRational, pair.decimals);
            
            if (pairQuantityRational.greater(walletbalanceOfPair)){
                throw Error(`Insufficient ${pair.symbol} balance`);
            }
    
            const pairQuantityBigNumber = BigNumber.from(pairQuantityRational.multiply(bigRational('10').pow(node.pairDecimals)).toDecimal(0));
            await checkAllowance({
                endpoint, 
                wallet: wallet, 
                addressToAllow: trackerPrivate.exchange.routerAddress,
                tokenAddress: pair.address, 
                requiredAmount: pairQuantityBigNumber
            });
    
            const tokenQuantityRational = pairQuantityRational.multiply(tokenPerLPRational);
            const minTokenQuantityRational = tokenQuantityRational.minus(tokenQuantityRational.multiply(slippageProportionRational));
            const minTokenQuantityBigNumber = BigNumber.from(minTokenQuantityRational.multiply(bigRational('10').pow(token.decimals)).toDecimal(0));
    
            const comparatorQuantityRational = pairQuantityRational.multiply(comparatorPerLPRational);
            const minComparatorQuantityRational = comparatorQuantityRational.minus(comparatorQuantityRational.multiply(slippageProportionRational));
            const minComparatorQuantityBigNumber = BigNumber.from(minComparatorQuantityRational.multiply(bigRational('10').pow(comparator.decimals)).toDecimal(0));
    
            const tokenPart = `${formatRational(minTokenQuantityRational, token.decimals)} ${token.symbol}`;
            const comparatorPart = `${formatRational(minComparatorQuantityRational, comparator.decimals)} ${comparator.symbol}`;
            const intentionStatement =  `Splitting ${pair.symbol} into minimum ${tokenPart} and ${comparatorPart} through ${trackerPrivate.exchange.routerAddress}`;
            log(intentionStatement);
    
            //finally, remove liquidity
            const deadline = Math.floor(Date.now() / 1000) + Number(timeoutSecs); //deadline is unix timestamp (seconds, not ms)
            if (util.isHexEqual(token.address, endpoint.nativeToken.address)){
                transactionResponse = await endpoint.sendTransaction(routerContract, 'removeLiquidityETH', comparator.address, 
                    pairQuantityBigNumber, minComparatorQuantityBigNumber, minTokenQuantityBigNumber, 
                    wallet.address, deadline, overrides
                );
            } else if (util.isHexEqual(comparator.address, endpoint.nativeToken.address)){
                transactionResponse = await endpoint.sendTransaction(routerContract, 'removeLiquidityETH', token.address, 
                    pairQuantityBigNumber, minTokenQuantityBigNumber, minComparatorQuantityBigNumber, 
                    wallet.address, deadline, overrides
                )
            } else {
                transactionResponse = await endpoint.sendTransaction(routerContract, 'removeLiquidityETH', token.address, comparator.address,
                    pairQuantityBigNumber, minTokenQuantityBigNumber, minComparatorQuantityBigNumber,
                    wallet.address, deadline, overrides
                )
            }
        }
    
        log(`Transaction ${transactionResponse.hash} sent - awaiting confirmation...`)
        const transactionReceipt = await waitForTransaction(endpoint, transactionResponse);
        const quantities = getLiquidityActionQuantitiesFromTransactionLogs({
            tracker,
            userWalletAddress: wallet.address,
            logs: transactionReceipt.logs
        });
        log('OK! TX: ' + transactionReceipt.transactionHash);
    
        return {
            transactionHash: transactionReceipt.transactionHash,
            ...quantities,
            ...(await getGasFeeSpent(endpoint, transactionResponse, transactionReceipt))
        }
    }


    function getLiquidityActionQuantitiesFromTransactionLogs({tracker, userWalletAddress, logs}){
        const quantityMap = {
            tokenQuantitySent: {
                address: tracker.token.address,
                from: userWalletAddress,
                to: tracker.pair.address,
                amountDecimals: tracker.token.decimals
            },
            tokenQuantityReceived: {
                address: tracker.token.address,
                from: tracker.pair.address,
                to: userWalletAddress,
                amountDecimals: tracker.token.decimals
            },
            
            comparatorQuantitySent: {
                address: tracker.comparator.address,
                from: userWalletAddress,
                to: tracker.pair.address,
                amountDecimals: tracker.comparator.decimals
            },
            comparatorQuantityReceived: {
                address: tracker.comparator.address,
                from: tracker.pair.address,
                to: userWalletAddress,
                amountDecimals: tracker.comparator.decimals
            },
    
            pairQuantitySent: {
                address: tracker.pair.address,
                from: userWalletAddress,
                to: tracker.pair.address,
                amountDecimals: tracker.pair.decimals
            },
            pairQuantityReceived: {
                address: tracker.pair.address,
                from: '0x00',
                to: userWalletAddress,
                amountDecimals: tracker.pair.decimals
            },
        }
    
        const ret = {};
        for (const quantityKey of Object.keys(quantityMap)){
            ret[quantityKey] = {string: '0', rational: bigRational.zero};
        }
    
        for (const log of logs){
            if (util.isHexEqual(log.topics[0], TRANSFER_FILTER_HASHED)){
                const [from, to, amountBigNumber] = [log.topics[1], log.topics[2], BigNumber.from(log.data)];
                console.log(from, to, amountBigNumber);
                for (const quantityKey of Object.keys(quantityMap)){
                    const quantityEntryInfo = quantityMap[quantityKey];
                    
                    if (util.isHexEqual(log.address, quantityEntryInfo.address)
                    && util.isHexEqual(from, quantityEntryInfo.from)
                    && util.isHexEqual(to, quantityEntryInfo.to)){
                        ret[quantityKey].rational = bigRational(amountBigNumber.toString()).divide(bigRational('10').pow(quantityEntryInfo.amountDecimals));
                        ret[quantityKey].string = util.formatRational(ret[quantityKey].rational, quantityEntryInfo.amountDecimals);
                    }
                }
            }
        }
        return ret;
    }




    return {
        buyTokensWithExact: ({privateKey, tracker, exactComparatorQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return swapUniswapV2({tracker, privateKey, method: 'buyTokensWithExact', exactQuantity: exactComparatorQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        sellTokensForExact: ({privateKey, tracker, exactComparatorQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return swapUniswapV2({tracker, privateKey, method: 'sellTokensForExact', exactQuantity: exactComparatorQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        buyExactTokens: ({privateKey, tracker, exactTokenQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return swapUniswapV2({tracker, privateKey, method: 'buyExactTokens', exactQuantity: exactTokenQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        sellExactTokens: ({privateKey, tracker, exactTokenQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return swapUniswapV2({tracker, privateKey, method: 'sellExactTokens', exactQuantity: exactTokenQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        
        swap: async function({privateKey, tracker, action, amount, specifying, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}){
            let method = action.toLowerCase();
            if (specifying.toUpperCase().endsWith('EXACTTOKENS')){
                method += 'ExactTokens';
            } else {
                method += action === 'buy' ? 'TokensWithExact' : 'TokensForExact'
            }
            return swapUniswapV2({tracker, privateKey, method, exactQuantity: amount, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});

        },
        addLiquidity: ({privateKey, tracker, tokenQuantity, minNativeReserved, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return addOrRemoveliquidityUniswapV2({tracker, privateKey, method: 'addLiquidity', tokenQuantity, minNativeReserved, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        removeLiquidity: ({privateKey, tracker, pairQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei}) => {
            return addOrRemoveliquidityUniswapV2({tracker, privateKey, method: 'removeLiquidity', pairQuantity, slippagePercent, timeoutSecs, gasPercentModifier, maxGasPriceGwei});
        },
        getLiquidityActionQuantitiesFromTransactionLogs: ({tracker, userWalletAddress, logs}) => {
            return getLiquidityActionQuantitiesFromTransactionLogs({tracker, userWalletAddress, logs});
        }
    }
})();















export default {...ethersBase, createWalletFromPrivateKey, createRandomWallet, createJsonRpcEndpoint, UniswapV2};
