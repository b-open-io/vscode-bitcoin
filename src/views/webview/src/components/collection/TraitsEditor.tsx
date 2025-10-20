import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Plus, Trash2, AlertCircle } from 'lucide-react';

interface TraitValue {
  value: string;
  percentage: string;
}

interface Trait {
  name: string;
  values: TraitValue[];
}

interface TraitsEditorProps {
  traits: Array<{
    name: string;
    values: string[];
    occurancePercentages: string[];
  }>;
  onChange: (traits: Array<{
    name: string;
    values: string[];
    occurancePercentages: string[];
  }>) => void;
}

export function TraitsEditor({ traits, onChange }: TraitsEditorProps) {
  // Convert from storage format to editing format
  const [editingTraits, setEditingTraits] = useState<Trait[]>(() => {
    if (traits.length > 0) {
      return traits.map(t => ({
        name: t.name,
        values: t.values.map((v, i) => ({
          value: v,
          percentage: t.occurancePercentages[i] || ''
        }))
      }));
    }
    return [{ name: '', values: [{ value: '', percentage: '' }] }];
  });

  const handleAddTrait = () => {
    const newTraits = [...editingTraits, { name: '', values: [{ value: '', percentage: '' }] }];
    setEditingTraits(newTraits);
  };

  const handleRemoveTrait = (traitIndex: number) => {
    const newTraits = editingTraits.filter((_, i) => i !== traitIndex);
    setEditingTraits(newTraits);
    updateParent(newTraits);
  };

  const handleTraitNameChange = (traitIndex: number, name: string) => {
    const newTraits = [...editingTraits];
    newTraits[traitIndex].name = name;
    setEditingTraits(newTraits);
    updateParent(newTraits);
  };

  const handleAddValue = (traitIndex: number) => {
    const newTraits = [...editingTraits];
    newTraits[traitIndex].values.push({ value: '', percentage: '' });
    setEditingTraits(newTraits);
  };

  const handleRemoveValue = (traitIndex: number, valueIndex: number) => {
    const newTraits = [...editingTraits];
    newTraits[traitIndex].values = newTraits[traitIndex].values.filter((_, i) => i !== valueIndex);
    setEditingTraits(newTraits);
    updateParent(newTraits);
  };

  const handleValueChange = (traitIndex: number, valueIndex: number, field: 'value' | 'percentage', val: string) => {
    const newTraits = [...editingTraits];
    newTraits[traitIndex].values[valueIndex][field] = val;
    setEditingTraits(newTraits);
    updateParent(newTraits);
  };

  const updateParent = (traits: Trait[]) => {
    // Convert back to storage format
    const formatted = traits
      .filter(t => t.name.trim()) // Only include traits with names
      .map(t => ({
        name: t.name,
        values: t.values.map(v => v.value).filter(v => v.trim()), // Only non-empty values
        occurancePercentages: t.values.map(v => v.percentage).filter((_, i) => t.values[i].value.trim())
      }))
      .filter(t => t.values.length > 0); // Only include traits with values

    onChange(formatted);
  };

  const getTraitTotal = (trait: Trait): number => {
    return trait.values.reduce((sum, v) => {
      const val = parseFloat(v.percentage) || 0;
      return sum + val;
    }, 0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Traits</Label>
          <p className="text-xs text-muted-foreground">
            Define traits and their possible values with occurrence percentages
          </p>
        </div>
        <Button onClick={handleAddTrait} size="sm" variant="outline">
          <Plus className="h-3 w-3 mr-1" />
          Add Trait
        </Button>
      </div>

      <Accordion type="multiple" className="w-full">
        {editingTraits.map((trait, traitIndex) => {
          const total = getTraitTotal(trait);
          const isValid = Math.abs(total - 100) < 0.01;

          return (
            <AccordionItem key={traitIndex} value={`trait-${traitIndex}`}>
              <AccordionTrigger className="text-xs py-2">
                <div className="flex items-center gap-2 flex-1">
                  <span className="font-mono">
                    {trait.name || `Trait ${traitIndex + 1}`}
                  </span>
                  {trait.name && (
                    <span className="text-muted-foreground">
                      ({trait.values.filter(v => v.value).length} values)
                    </span>
                  )}
                  {trait.name && trait.values.some(v => v.percentage) && (
                    <span className={`ml-auto text-xs ${isValid ? 'text-green-600' : 'text-amber-600'}`}>
                      {total.toFixed(1)}%
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  {/* Trait Name */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Trait name (e.g., Background, Eyes)"
                      value={trait.name}
                      onChange={(e) => handleTraitNameChange(traitIndex, e.target.value)}
                      className="h-8 text-xs flex-1"
                    />
                    <Button
                      onClick={() => handleRemoveTrait(traitIndex)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Trait Values */}
                  <div className="space-y-2 pl-3 border-l-2 border-muted">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Values</Label>
                      <Button
                        onClick={() => handleAddValue(traitIndex)}
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Value
                      </Button>
                    </div>

                    {trait.values.map((val, valueIndex) => (
                      <div key={valueIndex} className="flex gap-2 items-start">
                        <div className="flex-1">
                          <Input
                            placeholder="Value (e.g., Blue, Red, Green)"
                            value={val.value}
                            onChange={(e) => handleValueChange(traitIndex, valueIndex, 'value', e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="w-20">
                          <Input
                            type="number"
                            placeholder="%"
                            min="0"
                            max="100"
                            step="0.1"
                            value={val.percentage}
                            onChange={(e) => handleValueChange(traitIndex, valueIndex, 'percentage', e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                        <Button
                          onClick={() => handleRemoveValue(traitIndex, valueIndex)}
                          size="sm"
                          variant="ghost"
                          disabled={trait.values.length === 1}
                          className="h-7 w-7 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}

                    {/* Percentage total for this trait */}
                    {trait.values.some(v => v.percentage) && (
                      <div className={`text-xs flex items-center gap-2 ${isValid ? 'text-green-600' : 'text-amber-600'}`}>
                        {!isValid && <AlertCircle className="h-3 w-3" />}
                        <span>
                          Total: {total.toFixed(1)}%
                          {isValid ? ' ✓' : ' (should equal 100%)'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Example */}
      {editingTraits.length === 1 && !editingTraits[0].name && (
        <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
          <p className="font-semibold mb-1">Example:</p>
          <div className="space-y-2">
            <div>
              <p className="font-mono">Background</p>
              <ul className="pl-4 space-y-0.5">
                <li>Blue: 40%</li>
                <li>Red: 30%</li>
                <li>Green: 20%</li>
                <li>Purple: 10%</li>
              </ul>
            </div>
            <div>
              <p className="font-mono">Eyes</p>
              <ul className="pl-4 space-y-0.5">
                <li>Normal: 70%</li>
                <li>Laser: 20%</li>
                <li>Diamond: 10%</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
