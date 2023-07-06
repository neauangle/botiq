let logFunction = console.log;

export function setLogFunction(func){
	logFunction = func;
}


export function log(message){
	if (logFunction){
		logFunction(message);
	}
}
