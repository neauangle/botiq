import BigRational from 'big-rational'; const bigRational = BigRational; export {bigRational};
import * as util from '../util.js';


export function formatRational(rational, decimals){
    let rationalString = rational.toDecimal(decimals);
    if (rationalString.indexOf('.') >= 0){
        rationalString = util.trim(rationalString, '0');
        if (rationalString.startsWith('.') || !rationalString){
            rationalString = '0' + rationalString;
        }
    }
    return rationalString;
}

export function shiftDecimals(numberString, decimals){
    if (decimals >= 0){
        return formatRational(bigRational(numberString.toString()).multiply(bigRational('10').pow(decimals)), decimals);
    } else {
        decimals *= -1;
        return formatRational(bigRational(numberString.toString()).divide(bigRational('10').pow(decimals)), decimals);
    }
}