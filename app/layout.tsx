import './style.css'
export const metadata={title:'Nuvio Control Center',description:'Painel pessoal de operação do Nuvio',applicationName:'Nuvio Control Center',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'Nuvio Control'},icons:{icon:'/icons/nuvio-app.svg',apple:'/apple-icon.png'}}
export const viewport={themeColor:'#0b0c0f'}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
