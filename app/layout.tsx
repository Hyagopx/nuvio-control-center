import './style.css'
import './design-tokens.css'
import './navigation.css'
import './management-pages.css'
import './app-foundation.css'
export const metadata={title:'Nuvio Control Center',description:'Aplicação web para administrar perfis e dados da conta Nuvio.',applicationName:'Nuvio Control Center',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'black-translucent',title:'Nuvio Control'},icons:{icon:'/brand/nuvio-icon.png',apple:'/brand/nuvio-icon.png'}}
export const viewport={themeColor:'#0b0c0f'}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
