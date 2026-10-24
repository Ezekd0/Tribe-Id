export class ServiceError extends Error {
 constructor(public statusCode:number,public code:string,message:string) {super(message);}
}
