import type { Player } from '~/primitives/create-player'

export interface DebugInfo {
  player: Player
  getState: () => {
    isPlaying: boolean
    currentTime: number
    maxDuration: number
    loop: boolean
  }
}

export function makeDebugInfo(player: Player) {
  ;(window as any).__EDDY_DEBUG__ = {
    player,
    getState: () => ({
      isPlaying: player.isPlaying(),
      currentTime: player.time(),
      maxDuration: player.maxDuration(),
      loop: player.loop(),
    }),
  }
}
