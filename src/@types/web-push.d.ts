declare module 'web-push' {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  export function sendNotification(subscription: any, payload: string): Promise<any>
  export function sendNotification(subscription: any, payload: string, options: any): Promise<any>
}
