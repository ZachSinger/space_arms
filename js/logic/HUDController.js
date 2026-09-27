export class HUDController {
    constructor(playerState) {
        this.creditsEl = document.getElementById('hud-credits');
        this.repEl = document.getElementById('hud-rep');
        
        // Subscribe to the brain!
        playerState.subscribe((state) => this.render(state));
    }

    render(state) {
        // Render credits with commas
        this.creditsEl.innerText = `${state.credits.toLocaleString()}c`;
        
        // Toggle red color if in debt
        if (state.credits < 0) {
            this.creditsEl.classList.add('deficit');
        } else {
            this.creditsEl.classList.remove('deficit');
        }
        
        // Render raw reputation integer
        this.repEl.innerText = state.globalReputation;
    }
}