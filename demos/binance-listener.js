import botiq from '../index.js';

/*
Demonstrates botiq automatically showing fiat value of ETH trades/polls if it can find a conversion chain

NOTE: You don't actually need an API_KEY or API_SECRET for this demo- just run it!
*/

const connection = botiq.binance.createConnection({ apiKey: 'PASTE_API_KEY_HERE',  apiSecret: 'PASTE_API_SECRET_HERE'});
const btcTracker = await  connection.createTracker({tokenSymbol: 'BTC', comparatorSymbol: 'USDT', comparatorIsFiat: true});
const ethTracker = await  connection.createTracker({tokenSymbol: 'ETH', comparatorSymbol: 'BTC', comparatorIsFiat: false});

const listener = (swapDetails, tracker) => {
    console.log('    ', swapDetails.action, swapDetails.tokenQuantity.string, tracker.token.symbol, 
                'for', swapDetails.comparatorQuantity.string, tracker.comparator.symbol, 
                swapDetails.fiatQuantity.string? `($${swapDetails.fiatQuantity.string})` : ''
    );
}
ethTracker.addSwapListener({listener});
ethTracker.addPollingListener({listener, pollIntervalSeconds: 10});