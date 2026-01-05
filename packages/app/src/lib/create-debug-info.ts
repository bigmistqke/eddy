import type { Player } from '~/hooks/create-player'

export interface DebugInfo {
  player: Player
  getPlaybackStates: () => Array<{
    trackIndex: number
    state: string
    currentTime: number
    hasFrame: boolean
  }>
  downloadPreRender: () => void
}

export function createDebugInfo(player: Player): DebugInfo {
  return {
    player,
    getPlaybackStates: () => {
      const states = []
      for (let i = 0; i < 4; i++) {
        const slot = player.getSlot(i)
        if (slot.playback) {
          states.push({
            trackIndex: i,
            state: slot.playback.state,
            currentTime: player.time(),
            hasFrame: slot.playback.getFrameAt(player.time()) !== null,
          })
        }
      }
      return states
    },
    downloadPreRender: () => {
      const blob = player.preRenderer.blob()
      if (!blob) {
        console.log('No pre-rendered video available')
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'prerender.webm'
      link.click()
      URL.revokeObjectURL(url)
      console.log('Downloaded prerender.webm', { size: blob.size })
    },
  }
}
