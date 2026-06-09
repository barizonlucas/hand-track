# 🖐️ Handtrack Suite

Uma suíte interativa de visão computacional rodando 100% no client-side. 

O projeto nasceu como um experimento de integração com APIs de inteligência artificial em nuvem (Hugging Face), mas foi **pivotado** por uma decisão estratégica de produto: eliminar a fricção de rede, bloqueios de cota e latência. A arquitetura atual utiliza o MediaPipe via WebAssembly para entregar inferência local a 60 FPS, transformando o navegador em um motor de alta performance.

## 🎯 Os 4 Módulos

A suíte consolida quatro provas de conceito (PoCs) independentes, cada uma explorando uma dimensão técnica diferente da interação humano-computador:

1. **Simetria (Spatial Tracking):** Validação matemática espacial. O usuário precisa desenhar metades de formas geométricas complexas no ar. O motor utiliza um sistema de *waypoints* invisíveis para calcular a precisão do traçado em tempo real, sem sobrecarregar a CPU com cálculos de pixel.
2. **Sintetizador (Web Audio API):** Transformação de movimento contínuo em dados discretos. Uma mão controla o *pitch* (quantizado em uma escala diatônica de Dó Maior), enquanto a outra atua como um mixer expressivo (Volume e Filtro Passa-Baixa). 
3. **Reflexo (Multi-Hand Collision):** Uma máquina de estados focada em tempo de reação. Detecção de colisão contínua usando múltiplas mãos simultaneamente contra alvos dinâmicos gerados em *safe zones* da tela.
4. **Lockpick (Fine Motor Coordination):** O desafio anatômico. Lê exclusivamente os eixos Y de quatro dedos independentes (ignorando o polegar) para forçar um alinhamento isométrico simultâneo.

## ⚙️ Stack & Arquitetura

* **Engine Core:** MediaPipe Hand Landmarker (via WebAssembly).
* **Frontend:** HTML5 Canvas, Vanilla JavaScript (ES6+), Web Audio API e CSS3 Brutalista.
* **Infraestrutura / Deploy:** Servido estaticamente via Nginx (Alpine), roteado por Nginx Proxy Manager e blindado via Cloudflare Zero Trust Tunnels.
* **Zero Backend:** Nenhuma dependência de Node.js, WebSockets ou APIs de terceiros no runtime.

## 🚀 Como Rodar Localmente

Como o projeto é 100% client-side, ele não requer build steps ou instalação de pacotes.

1. Clone o repositório:
   ```bash
   git clone [https://github.com/barizonlucas/hand-track.git](https://github.com/barizonlucas/hand-track.git)