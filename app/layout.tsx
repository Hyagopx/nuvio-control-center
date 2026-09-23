import './style.css'
export const metadata={title:'Nuvio Control Center',description:'Painel pessoal de operação do Nuvio'}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}