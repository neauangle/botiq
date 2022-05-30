**BOTIQ**: High-level library useful for creating cryptocurrency bots.

See ./demos/ for working examples. 

##### Notes:
* Has NOT undergone extensive testing. Waiting for price movements and swapping on both ethereum (and bsc, fantom, avax-c, etc...) and binance seems to be working as expected. I would definitely say it's not ready for use in critical environments, and any testing you can do to move the confidence meter in that direction would be awesome!
* The ethers backend will only work for factories and routers that abide by uniswap v2.
* An informal TODO is in index.js. If you want to add to it, please make use of github's issue tracker.


##### Basic code structure:
ethers.js and binance.js handle the specifics of their tokens, while common.js is the place to look for the actual tracker API. It should be quite easy to add CEXs if you make judicious use of common.massageCexMarketSwapData.



##### Goal:
Primarily, I hope the botiq library will make it easier to write and share your own bots by abstracting away as much of implementation details as possible and letting you focus on the *logic* of your bots. As is hopefully in the demos folder, I'm trying to make coding bots practically declarative!

Extending upon that idea, I want to then use botiq myself to create small, task-specific bots which import config files for parameters and api keys, etc. This way, only the config file and the bot script need be sent to any vps that you can get node to run on. This is the opposite of the approach I took with [Botchi](https://github.com/neauangle/botchi), which was developed as a monolithic electron-based bot suite that required a desktop environment and forfeited the logical expressiveness that code inherently gives us.

In the future I hope to have a collection of simple bots such as
* await fall/rise then buy/sell/play alarm/send email
* autocompounder
* grid bot

perhaps with accompanying simply gui forms to aide in the creation of the config files. This is all another attempt, after Botchi, at granting non-developers the power of trading bots.



