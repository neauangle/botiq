High-level library useful for creating cryptocurrency bots. Has NOT undergone extensive testing, but waiting for price movements
and swapping on both ethereum (and bsc, fantom, avax-c, etc...) and binance seems to be working as expected. 

NOTE: The ethers backend will only work for factories and routers that abide by uniswap v2.

An informal TODO is in index.js. If you want to add to it, please make use of github's issue tracker.

Basic structure: ethers.js and binance.js handle the specifics of their tokens, while common.js is the place to look for the actual tracker API. It should be quite easy to add CEXs if you make judicious use of common.massageCexMarketSwapData.

See ./demos/ for working examples. 

--------

The idea is to create a smooth workflow for making small, task-specific bot scripts which import short config files for parameters and api keys, etc. This way, only the config file and the bot script need be sent to any vps that you can get node to run on. This is the opposite of the approach I took with Botchi, which was developed as a monolithic electron-based bot suite that required a desktop environment and forfeited the logical expressiveness that code gives us.

So in the future I hope to have a collection of simple bots such as
* autocompounder
* grid bot
* simple price threshold bots
perhaps with an accompanying simply gui form to aide in the creation of the config files, AND I hope the botiq library itself will make it easier for other developers to write and share their own bots.

