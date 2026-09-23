import './style.css'
export const metadata={title:'Nuvio Control Center',description:'Painel pessoal de operação do Nuvio',applicationName:'Nuvio Control Center',manifest:'/manifest.webmanifest',themeColor:'#0b0c0f',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'Nuvio Control'},icons:{apple:'/apple-icon.png'}}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
