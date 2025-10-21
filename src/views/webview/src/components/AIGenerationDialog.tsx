import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sparkles, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getVscode } from '../vscode'

const vscode = getVscode()

interface AIGenerationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: 'rarities' | 'traits'
  collectionName?: string
  onGenerated: (data: any) => void
}

// Preset prompts for common collection types
const RARITY_PRESETS = [
  {
    name: 'Trading Card (MTG)',
    description: 'Common, Uncommon, Rare, Mythic Rare',
    prompt: 'Create a rarity system like Magic: The Gathering with Common (60%), Uncommon (25%), Rare (12%), and Mythic Rare (3%) rarities.'
  },
  {
    name: 'Collectible Card (FAB)',
    description: 'Common, Rare, Super Rare, Majestic, Legendary, Fabled',
    prompt: 'Create a rarity system like Flesh & Blood with Common (45%), Rare (30%), Super Rare (15%), Majestic (7%), Legendary (2.5%), and Fabled (0.5%) rarities.'
  },
  {
    name: 'NFT Standard',
    description: 'Common, Uncommon, Rare, Epic, Legendary',
    prompt: 'Create an NFT rarity system with Common (50%), Uncommon (30%), Rare (15%), Epic (4%), and Legendary (1%) rarities.'
  },
  {
    name: 'Gaming Loot',
    description: 'Common, Uncommon, Rare, Epic, Legendary, Mythic',
    prompt: 'Create a gaming loot rarity system with Common (40%), Uncommon (30%), Rare (20%), Epic (7%), Legendary (2.5%), and Mythic (0.5%) rarities.'
  }
]

const TRAIT_PRESETS = [
  {
    name: 'Character Traits',
    description: 'Class, Background, Race, Alignment',
    prompt: 'Create character traits including Class (Warrior, Mage, Rogue, Ranger), Background (Noble, Commoner, Scholar, Outlaw), Race (Human, Elf, Dwarf, Orc), and Alignment (Lawful, Neutral, Chaotic) with balanced distribution.'
  },
  {
    name: 'Art Style Traits',
    description: 'Color Palette, Style, Mood, Texture',
    prompt: 'Create art style traits including Color Palette (Vibrant, Muted, Monochrome, Pastel), Style (Realistic, Abstract, Pixel, Vector), Mood (Energetic, Calm, Dark, Cheerful), and Texture (Smooth, Rough, Glitchy, Organic).'
  },
  {
    name: 'Equipment Traits',
    description: 'Weapon, Armor, Accessory, Special Item',
    prompt: 'Create equipment traits including Weapon (Sword, Bow, Staff, Dagger), Armor (Heavy, Medium, Light, Robes), Accessory (Ring, Amulet, Cape, Crown), and Special Item (Potion, Scroll, Gem, Relic).'
  },
  {
    name: 'Environment Traits',
    description: 'Background, Weather, Time, Location',
    prompt: 'Create environment traits including Background (Forest, Mountains, Ocean, Desert), Weather (Sunny, Rainy, Stormy, Snowy), Time (Dawn, Day, Dusk, Night), and Location (Indoor, Outdoor, Underground, Sky).'
  }
]

export function AIGenerationDialog({ open, onOpenChange, type, collectionName, onGenerated }: AIGenerationDialogProps) {
  const [customPrompt, setCustomPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedData, setGeneratedData] = useState<any>(null)

  const presets = type === 'rarities' ? RARITY_PRESETS : TRAIT_PRESETS

  const handlePresetClick = (prompt: string) => {
    setCustomPrompt(prompt)
  }

  const handleGenerate = async () => {
    if (!customPrompt.trim()) return

    setIsGenerating(true)
    setGeneratedData(null)

    try {
      // Send generation request to backend
      const requestId = Math.random().toString(36).substring(7)

      vscode.postMessage({
        command: 'generateAI',
        type,
        prompt: customPrompt,
        collectionName: collectionName || 'My Collection',
        requestId
      })

      // Listen for response
      const handleMessage = (event: MessageEvent) => {
        const { command, requestId: responseId, data, error } = event.data

        if (command === 'aiGenerationResult' && responseId === requestId) {
          window.removeEventListener('message', handleMessage)
          setIsGenerating(false)

          if (error) {
            console.error('AI generation error:', error)
            alert(`Failed to generate: ${error}`)
          } else {
            setGeneratedData(data)
          }
        }
      }

      window.addEventListener('message', handleMessage)

      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', handleMessage)
        if (isGenerating) {
          setIsGenerating(false)
          alert('Generation timed out. Please try again.')
        }
      }, 30000)

    } catch (error) {
      console.error('Generation error:', error)
      setIsGenerating(false)
      alert('Failed to generate. Please try again.')
    }
  }

  const handleApply = () => {
    if (generatedData) {
      onGenerated(generatedData)
      onOpenChange(false)
      setCustomPrompt('')
      setGeneratedData(null)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    setCustomPrompt('')
    setGeneratedData(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI {type === 'rarities' ? 'Rarity' : 'Trait'} Generation
          </DialogTitle>
          <DialogDescription>
            Use AI to generate {type === 'rarities' ? 'rarity labels' : 'trait definitions'} for your collection.
            Choose a preset or write your own prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Preset Buttons */}
          <div>
            <Label className="text-sm font-medium mb-3 block">Quick Presets</Label>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <Card
                  key={preset.name}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handlePresetClick(preset.prompt)}
                >
                  <CardContent className="p-3">
                    <h4 className="font-semibold text-sm mb-1">{preset.name}</h4>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Custom Prompt */}
          <div>
            <Label htmlFor="ai-prompt" className="text-sm font-medium mb-2 block">
              Custom Instructions
            </Label>
            <Input
              id="ai-prompt"
              placeholder={`Describe the ${type} you want to generate...`}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[80px] resize-none"
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Example: "Create 5 rarity tiers from common to mythic with decreasing percentages"
            </p>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={!customPrompt.trim() || isGenerating}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate {type === 'rarities' ? 'Rarities' : 'Traits'}
              </>
            )}
          </Button>

          {/* Generated Results */}
          {generatedData && (
            <Card className="border-primary/50">
              <CardContent className="p-4 space-y-3">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Generated {type === 'rarities' ? 'Rarities' : 'Traits'}
                </h4>

                {type === 'rarities' && generatedData.rarityLabels && (
                  <div className="space-y-2">
                    {generatedData.rarityLabels.map((rarity: any, index: number) => (
                      <div key={index} className="flex justify-between items-center text-sm p-2 rounded bg-muted/50">
                        <span className="font-medium">{rarity.label}</span>
                        <span className="text-muted-foreground font-mono">{rarity.percentage}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {type === 'traits' && generatedData.traits && (
                  <div className="space-y-3">
                    {generatedData.traits.map((trait: any, index: number) => (
                      <div key={index} className="space-y-1">
                        <h5 className="font-medium text-sm">{trait.name}</h5>
                        <div className="flex flex-wrap gap-1">
                          {trait.values.map((value: string, vi: number) => (
                            <span
                              key={vi}
                              className="text-xs bg-muted px-2 py-1 rounded"
                            >
                              {value} ({trait.occurancePercentages[vi]}%)
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleApply} className="flex-1">
                    Apply to Collection
                  </Button>
                  <Button onClick={() => setGeneratedData(null)} variant="outline">
                    Regenerate
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cancel Button */}
          {!generatedData && (
            <Button onClick={handleCancel} variant="outline" className="w-full">
              Cancel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
