import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';

interface Trait {
  name: string;
  value: string;
}

interface TraitOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  currentTraits: Trait[];
  currentRarityLabel?: string;
  onSave: (traits: Trait[], rarityLabel: string) => void;
}

export function TraitOverrideDialog({
  open,
  onOpenChange,
  fileName,
  currentTraits,
  currentRarityLabel,
  onSave
}: TraitOverrideDialogProps) {
  const [traits, setTraits] = useState<Trait[]>(currentTraits.length > 0 ? [...currentTraits] : [{ name: '', value: '' }]);
  const [rarityLabel, setRarityLabel] = useState(currentRarityLabel || '');

  const handleAddTrait = () => {
    setTraits([...traits, { name: '', value: '' }]);
  };

  const handleRemoveTrait = (index: number) => {
    setTraits(traits.filter((_, i) => i !== index));
  };

  const handleTraitChange = (index: number, field: 'name' | 'value', value: string) => {
    const newTraits = [...traits];
    newTraits[index][field] = value;
    setTraits(newTraits);
  };

  const handleSave = () => {
    // Filter out empty traits
    const validTraits = traits.filter(t => t.name.trim() && t.value.trim());
    onSave(validTraits, rarityLabel);
    onOpenChange(false);
  };

  const handleCancel = () => {
    // Reset to original values
    setTraits(currentTraits.length > 0 ? [...currentTraits] : [{ name: '', value: '' }]);
    setRarityLabel(currentRarityLabel || '');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Traits</DialogTitle>
          <DialogDescription className="text-xs">
            Customize traits and rarity for: <span className="font-mono">{fileName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Rarity Label */}
          <div className="space-y-2">
            <Label htmlFor="rarity" className="text-sm">Rarity Label</Label>
            <Input
              id="rarity"
              placeholder="e.g., Common, Rare, Legendary"
              value={rarityLabel}
              onChange={(e) => setRarityLabel(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Traits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Traits</Label>
              <Button onClick={handleAddTrait} size="sm" variant="ghost" className="h-6 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Add Trait
              </Button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {traits.map((trait, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="Name"
                    value={trait.name}
                    onChange={(e) => handleTraitChange(index, 'name', e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                  <Input
                    placeholder="Value"
                    value={trait.value}
                    onChange={(e) => handleTraitChange(index, 'value', e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    onClick={() => handleRemoveTrait(index)}
                    size="sm"
                    variant="ghost"
                    disabled={traits.length === 1}
                    className="h-7 w-7 p-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleCancel} variant="outline" size="sm">
            Cancel
          </Button>
          <Button onClick={handleSave} size="sm">
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
