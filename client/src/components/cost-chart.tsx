import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CostChartProps {
  data: any[];
  type?: 'usage' | 'cost' | 'performance';
  height?: number;
  className?: string;
}

export function CostChart({ data, type = 'usage', height = 300, className }: CostChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return [] as any[];
    }
    return data;
  }, [data]);

  const isEmpty = chartData.length === 0;

  const maxValue = useMemo(() => {
    if (isEmpty) return 0;
    if (type === 'cost') {
      return Math.max(...chartData.map(d => d.cost || 0));
    } else if (type === 'performance') {
      return Math.max(...chartData.map(d => d.averageLatency || 0));
    }
    return Math.max(...chartData.map(d => d.requests || 0));
  }, [chartData, type, isEmpty]);

  const getDataValue = (item: any) => {
    switch (type) {
      case 'cost':
        return item.cost || 0;
      case 'performance':
        return item.averageLatency || 0;
      default:
        return item.requests || 0;
    }
  };

  const getColor = () => {
    switch (type) {
      case 'cost':
        return 'text-purple-400';
      case 'performance':
        return 'text-orange-400';
      default:
        return 'text-blue-400';
    }
  };

  const getLabel = () => {
    switch (type) {
      case 'cost':
        return 'Cost ($)';
      case 'performance':
        return 'Latency (ms)';
      default:
        return 'Requests';
    }
  };

  if (isEmpty) {
    return (
      <div className={className}>
        <div
          style={{ height }}
          className="flex flex-col items-center justify-center border border-dashed border-slate-700 rounded-lg bg-slate-900/40"
          role="status"
          aria-live="polite"
        >
          <div className="text-sm font-medium text-slate-400 mb-1">No data yet</div>
          <div className="text-xs text-slate-500">
            {type === 'cost'
              ? 'Cost data will appear once requests are billed.'
              : type === 'performance'
              ? 'Latency data will appear after the first request.'
              : 'Request volume will appear once traffic flows through.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div style={{ height }} className="relative">
        {/* Y-axis */}
        <div className="absolute left-0 top-0 h-full w-12 flex flex-col justify-between text-xs text-slate-400">
          <span>{maxValue.toFixed(type === 'cost' ? 2 : 0)}</span>
          <span>{(maxValue * 0.75).toFixed(type === 'cost' ? 2 : 0)}</span>
          <span>{(maxValue * 0.5).toFixed(type === 'cost' ? 2 : 0)}</span>
          <span>{(maxValue * 0.25).toFixed(type === 'cost' ? 2 : 0)}</span>
          <span>0</span>
        </div>

        {/* Chart Area */}
        <div className="ml-12 mr-4 h-full relative border-l border-b border-slate-700">
          {/* Grid Lines */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <div
              key={ratio}
              className="absolute left-0 right-0 border-t border-slate-800"
              style={{ top: `${(1 - ratio) * 100}%` }}
            />
          ))}

          {/* Data Points and Lines */}
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            
            {/* Area Fill */}
            <path
              d={`M 0 ${height} ${chartData.map((item, index) => {
                const x = (index / (chartData.length - 1)) * 100;
                const y = ((maxValue - getDataValue(item)) / maxValue) * 100;
                return `L ${x}% ${y}%`;
              }).join(' ')} L 100% ${height} Z`}
              fill="url(#chartGradient)"
              className={getColor()}
            />
            
            {/* Line */}
            <polyline
              points={chartData.map((item, index) => {
                const x = (index / (chartData.length - 1)) * 100;
                const y = ((maxValue - getDataValue(item)) / maxValue) * 100;
                return `${x}%,${y}%`;
              }).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={getColor()}
            />
            
            {/* Data Points */}
            {chartData.map((item, index) => {
              const x = (index / (chartData.length - 1)) * 100;
              const y = ((maxValue - getDataValue(item)) / maxValue) * 100;
              return (
                <circle
                  key={index}
                  cx={`${x}%`}
                  cy={`${y}%`}
                  r="3"
                  fill="currentColor"
                  className={`${getColor()} hover:r-4 transition-all cursor-pointer`}
                >
                  <title>{`${getLabel()}: ${getDataValue(item).toFixed(type === 'cost' ? 2 : 0)}`}</title>
                </circle>
              );
            })}
          </svg>
        </div>

        {/* X-axis */}
        <div className="ml-12 mr-4 mt-2 flex justify-between text-xs text-slate-400">
          {chartData.map((item, index) => {
            if (index % Math.ceil(chartData.length / 6) === 0) {
              const date = new Date(item.timestamp);
              return (
                <span key={index}>
                  {date.getHours().toString().padStart(2, '0')}:00
                </span>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center space-x-6 text-sm">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${getColor().replace('text-', 'bg-')}`}></div>
          <span className="text-slate-300">{getLabel()}</span>
        </div>
        
        {type === 'usage' && (
          <>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
              <span className="text-slate-300">Successful</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <span className="text-slate-300">Failed</span>
            </div>
          </>
        )}
      </div>

      {/* Summary Stats */}
      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-slate-800/50 rounded-lg">
          <div className={`text-lg font-bold ${getColor()}`}>
            {chartData.reduce((sum, item) => sum + getDataValue(item), 0).toFixed(type === 'cost' ? 2 : 0)}
          </div>
          <div className="text-xs text-slate-400">Total</div>
        </div>
        <div className="p-3 bg-slate-800/50 rounded-lg">
          <div className={`text-lg font-bold ${getColor()}`}>
            {(chartData.reduce((sum, item) => sum + getDataValue(item), 0) / chartData.length).toFixed(type === 'cost' ? 2 : 0)}
          </div>
          <div className="text-xs text-slate-400">Average</div>
        </div>
        <div className="p-3 bg-slate-800/50 rounded-lg">
          <div className={`text-lg font-bold ${getColor()}`}>
            {maxValue.toFixed(type === 'cost' ? 2 : 0)}
          </div>
          <div className="text-xs text-slate-400">Peak</div>
        </div>
      </div>
    </div>
  );
}
