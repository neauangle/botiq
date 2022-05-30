

function calculateMfiItem(bar, previousMfiItem){
    const typicalPrice = (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
    const value = typicalPrice * Number(bar.volume.comparator);
    const isPositive = !previousMfiItem || typicalPrice >= previousMfiItem.typicalPrice;
    return {typicalPrice, value, isPositive};
}

function calculateMfi(mfiItems){
    let sumPositive = 0;
    let sumNegative = 0;
    for (let i = 0; i < mfiItems.length; ++i){
        const mfiItem = mfiItems[i];
        if (mfiItem.isPositive){
            sumPositive += mfiItem.value;
        } else {
            sumNegative += mfiItem.value;
        }
    }
    
    return 100 - (100 / (1 + (sumPositive/sumNegative)));
}


export async function awaitMfi({barManager, durationKey, frameLength, predicate}){
    const mfiItems = getMfiItems(barManager, durationKey, frameLength);
    console.log('z', mfiItems.length)

    return new Promise((resolve, reject) => {
        barManager.addNewBarListener({durationKey, listener: ({bar}) => {
            mfiItems.push(calculateMfiItem(bar, mfiItems.length ? mfiItems[mfiItems.length-1] : null));
            while (mfiItems.length > frameLength){
                mfiItems.shift();
            }
        }});

        barManager.addPriceListener({listener: (price) => {
            console.log('here');
            mfiItems[mfiItems.length-1] = calculateMfiItem(barManager.getCurrentBar(durationKey), mfiItems.length >= 2 ? mfiItems[mfiItems.length-2] : null);
            if (mfiItems.length === frameLength){
                const mfi = calculateMfi(mfiItems);
                console.log('mfi:', mfi);
                if (predicate(mfi)){
                    resolve();
                }
            }
        }});
    });
}


function getMfiItems(barManager, durationKey, frameLength){
    const bars = barManager.durationKeyToBars[durationKey];
    const endIndex = bars.length - 1;
    const startIndex =  Math.max(0, endIndex - frameLength + 1);
    const mfiItems = [];
    for (let i = startIndex; i <= endIndex; ++i){
        mfiItems.push(calculateMfiItem(bars[i], mfiItems.length ? mfiItems[mfiItems.length-1] : null));
    }
    return mfiItems;
}

export function getMfi({barManager, durationKey, frameLength}){
    const mfiItems = getMfiItems(barManager, durationKey, frameLength);
    if (mfiItems.length < frameLength){
        throw Error("Not enough bars to satisfy MFI frame length");
    }
    return calculateMfi(mfiItems, frameLength);
}


