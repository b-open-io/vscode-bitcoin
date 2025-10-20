import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, AlertCircle } from 'lucide-react';

interface RarityLabel {
  label: string;
  percentage: string;
}

interface RarityEditorProps {
  rarities: RarityLabel[];
  onChange: (rarities: RarityLabel[]) => void;
}

export function RarityEditor({ rarities, onChange }: RarityEditorProps) {
  const [editingRarities, setEditingRarities] = useState<RarityLabel[]>(
    rarities.length > 0 ? rarities : [{ label: '', percentage: '' }]
  );

  const handleAdd = () => {
    const newRarities = [...editingRarities, { label: '', percentage: '' }];
    setEditingRarities(newRarities);
  };

  const handleRemove = (index: number) => {
    const newRarities = editingRarities.filter((_, i) => i !== index);
    setEditingRarities(newRarities);
    onChange(newRarities);
  };

  const handleChange = (index: number, field: 'label' | 'percentage', value: string) => {
    const newRarities = [...editingRarities];
    newRarities[index][field] = value;
    setEditingRarities(newRarities);
    onChange(newRarities);
  };

  // Calculate total percentage
  const totalPercentage = editingRarities.reduce((sum, r) => {
    const val = parseFloat(r.percentage) || 0;
    return sum + val;
  }, 0);

  const isValid = Math.abs(totalPercentage - 100) < 0.01;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Rarity Labels</Label>
          <p className="text-xs text-muted-foreground">
            Define rarity tiers and their distribution percentages
          </p>
        </div>
        <Button onClick={handleAdd} size="sm" variant="outline">
          <Plus className="h-3 w-3 mr-1" />
          Add Rarity
        </Button>
      </div>

      <div className="space-y-2">
        {editingRarities.map((rarity, index) => (
          <div key={index} className="flex gap-2 items-start">
            <div className="flex-1">
              <Input
                placeholder="e.g., Common, Rare, Legendary"
                value={rarity.label}
                onChange={(e) => handleChange(index, 'label', e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="w-24">
              <Input
                type="number"
                placeholder="%"
                min="0"
                max="100"
                step="0.1"
                value={rarity.percentage}
                onChange={(e) => handleChange(index, 'percentage', e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Button
              onClick={() => handleRemove(index)}
              size="sm"
              variant="ghost"
              disabled={editingRarities.length === 1}
              className="h-8 w-8 p-0"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Percentage validation */}
      <div className={`text-xs flex items-center gap-2 ${isValid ? 'text-green-600' : 'text-amber-600'}`}>
        {!isValid && <AlertCircle className="h-3 w-3" />}
        <span>
          Total: {totalPercentage.toFixed(1)}%
          {isValid ? ' ✓' : ' (must equal 100%)'}
        </span>
      </div>

      {/* Example */}
      {editingRarities.length === 1 && !editingRarities[0].label && (
        <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
          <p className="font-semibold mb-1">Example:</p>
          <ul className="space-y-0.5">
            <li>Common: 60%</li>
            <li>Rare: 30%</li>
            <li>Legendary: 10%</li>
          </ul>
        </div>
      )}
    </div>
  );
}
