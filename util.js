import fs from 'fs';
import bigRational from "big-rational";


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
    return hexA.toUpperCase() === hexB.toUpperCase();
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

/* export function getTimeString(dateObject){
    const str = date.toISOString().slice(0, 19).replace(/-/g, "/").replace("T", " ");
    return str;
} */