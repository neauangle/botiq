import botiq from '../index.js';

const tokenTracker = undefined;//either a binance or ethers tracker

const listener = ((eventObject, tracker) => {
    console.log(eventObject);
    /*
        trackerId,
        timestamp,
        action,
        ...tradeDetails (see notes in ./limit_buy.js)
    */
});
//add a swap listener- called for each swap
const swapListenerKey = tokenTracker.addSwapListener({listener});

//add a polling listener- updates price every pollIntervalSeconds
const pollingListenerKey = tokenTracker.addPollingListener({listener, pollIntervalSeconds: 10});

//remove listeners
tokenTracker.removeListener({key: swapListenerKey});
tokenTracker.removeListener({key: pollingListenerKey});


//to set up a simple listener that streams trades to output, simply use
tokenTracker.addSwapListener({listener: botiq.util.GENERIC_LOGGING_LISTENER});
