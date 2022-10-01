import fs from 'fs';
import bigRational from "big-rational";
import { BigNumber } from 'ethers';
import { utils } from 'ethers';

let idCounter = 0;

export function getUniqueId(){
    return (idCounter++).toString();
}


//https://stackoverflow.com/a/55292366
export function trim(str, ch) {
    var start = 0, 
        end = str.length;

    while(start < end && str[start] === ch)
        ++start;

    while(end > start && str[end - 1] === ch)
        --end;

    return (start > 0 || end < str.length) ? str.substring(start, end) : str;
}


export function formatRational(rational, decimals){
    let rationalString = rational.toDecimal(decimals);
    if (rationalString.indexOf('.') >= 0){
        rationalString = trim(rationalString, '0');
        if (rationalString.startsWith('.') || !rationalString){
            rationalString = '0' + rationalString;
        }
    }
    return rationalString;
}

export async function awaitMs(ms) {
    return new Promise(function (resolve, reject) {
        setTimeout(resolve, ms)
    })
}

export function isHexEqual(hexA, hexB){
    //console.log(utils.hexValue(hexA), utils.hexValue(hexB), utils.hexValue(hexA) === utils.hexValue(hexB))
    return utils.hexValue(hexA) === utils.hexValue(hexB);
}


export function readDataLinesFromFile({filepath, lineProcessor}){
    const fileLines = fs.readFileSync(filepath, {'encoding': 'utf-8'}).split('\n');
    const data = [];
    for (let i = (0); i < fileLines.length; ++i){
        const datum = lineProcessor(i, fileLines[i]);
        if (datum){
            data.push(datum);
        }
    }
    return data;
}

//grow this as needed
export const OP_FUNCTIONS = {
    '<': (a, b) => a < b,
    '=': (a, b) => a > b,
    '<=': (a, b) => a <= b,
    '>=': (a, b) => a >= b,
}

/* export function writeDataLinesToFile({dataLines: testData}){
    fs.writeFileSync(filepath, testData.join('\n'));
}
 */


//this will work with bigNumber too (from ethers)
export function shiftDecimals(numberString, decimals){
    if (decimals >= 0){
        return formatRational(bigRational(numberString.toString()).multiply(bigRational('10').pow(decimals)), decimals);
    } else {
        decimals *= -1;
        return formatRational(bigRational(numberString.toString()).divide(bigRational('10').pow(decimals)), decimals);
    }
}


export async function raceToResolve(keytoFunction){
    const promiseArray = [];
    for (const key of Object.keys(keytoFunction)){
        promiseArray.push(new Promise(async (resolve, reject) => {
            await keytoFunction[key];
            resolve(key);
        }));
    }
    return Promise.any(promiseArray);
}



export const GENERIC_LOGGING_LISTENER = (swapDetails, tracker) => {
    console.log(
        '    ', swapDetails.action, swapDetails.tokenQuantity.string, tracker.token.symbol, 
        'for', swapDetails.comparatorQuantity.string, tracker.comparator.symbol, 
        swapDetails.fiatQuantity.string? `($${swapDetails.fiatQuantity.string})` : '',
        
        '\n        ', 'Average price:', 
        swapDetails.averageTokenPriceComparator.string, tracker.comparator.symbol,  
        swapDetails.averageTokenPriceFiat.string? `($${swapDetails.averageTokenPriceFiat.string})` : ''
    );
}

export function makeBigNumber(arg){
    return BigNumber.from(arg);
}

export function makeRational(number, decimals){
    return bigRational(number.toString()).divide(bigRational('10').pow(decimals))
}


//https://stackoverflow.com/questions/5767325/how-can-i-remove-a-specific-item-from-an-array
export function removeArrayItemOnce(arr, value) {
    var index = arr.indexOf(value);
    if (index > -1) {
      arr.splice(index, 1);
    }
    return arr;
  }
//https://stackoverflow.com/questions/5767325/how-can-i-remove-a-specific-item-from-an-array
export function removeArrayItemAll(arr, value) {
    var i = 0;
    while (i < arr.length) {
        if (arr[i] === value) {
            arr.splice(i, 1);
        } else {
            ++i;
        }
    }
    return arr;
}


export function toCapitalCase(string){
    let ret = '';
    for (const word of string.split(' ')){
        ret += word.length >= 2 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toUpperCase();
        ret += ' ';
    }
    return ret.trim();
}

export function locale(n){
    return n.toLocaleString(undefined, {maximumFractionDigits: 10});
}

//https://gist.github.com/djD-REK/068cba3d430cf7abfddfd32a5d7903c3
//doe snot work if number is already in exponential notation.
export function roundAccurately(number, decimalPlaces, padAsString){
    const ret =  Number(Math.round(number + "e" + decimalPlaces) + "e-" + decimalPlaces);
    if (padAsString){
        return padAfterDecimalPlaces(ret, decimalPlaces);
    } else {
        return ret;
    }
}