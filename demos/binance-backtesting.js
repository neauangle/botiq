import botiq from '../index.js';

/*
Demonstrates backtesting a bot (in this case we are just waiting for the price to rise to $1945) with historic trade data.

You will need to grab some test data from https://data.binance.vision/data/spot/daily/trades/ETHUSDT/ETHUSDT-trades-2022-05-19.zip 
//and unzip into ./testdata/

You can test ethereum trackers in the same way but you would need to get the testData yourself.

NOTE: You don't actually need an API_KEY or API_SECRET for this demo.
*/


const connection = botiq.binance.createConnection({ apiKey: 'PASTE_API_KEY_HERE',  apiSecret: 'PASTE_API_SECRET_HERE'});
const ethTracker = await  connection.createTracker({tokenSymbol: 'ETH', comparatorSymbol: 'USDT', comparatorIsFiat: true});

const testData = botiq.binance.getTestDataFromHistoricTradesFile(
    {filepath: './testdata/ETHUSDT-trades-2022-05-19.csv', everyNthTrade: 100
});

//must come before any listeners are added because it inits the "current" price as indicated by the first test stream trade
const testStreamKey = ethTracker.startTestStream({testData});

const listenerKey = ethTracker.addSwapListener({listener: (swapDetails, tracker) => {
    console.log('    ', swapDetails.action, swapDetails.tokenQuantity.string, tracker.token.symbol, 
                'for', swapDetails.comparatorQuantity.string, tracker.comparator.symbol, 
                swapDetails.fiatQuantity.string? `($${swapDetails.fiatQuantity.string})` : ''
    );
    console.log(`Price: $${swapDetails.averageTokenPriceComparator.string}`);
    if (swapDetails.averageTokenPriceComparator.rational.greater(1945)){
        ethTracker.addTestStreamNote({testStreamKey, text: 'Price surpassed target!'});
        ethTracker.removeListener({key: listenerKey});
        ethTracker.endTestStream({testStreamKey});
        console.log(ethTracker.getTestStreamNotes({testStreamKey}));
    }
}});
















/* 
//testing bar manager. note: bar manager is experimental
const barManager = botiq.modules.barManager.createBarManager({tracker: ethTracker, durationKeys: ['1m', '1h']});
barManager.addNewBarListener({durationKey: '1m', listener: ({bar}) => {
    console.log(`1m bar closed at ${bar.close}`);
}});
barManager.addNewBarListener({durationKey: '1h', listener: ({bar}) => {
    console.log(`1h bar closed at ${bar.close}`);
}});


 */