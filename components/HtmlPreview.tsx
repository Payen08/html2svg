import React, { useState, useEffect } from 'react';
import { Download, Copy, Check, Code, Eye, FileCode2, Palette } from 'lucide-react';
import { Button } from './Button';

interface HtmlPreviewProps {
    htmlContent: string | null;
    cssContent: string | null;
    isLoading: boolean;
}

type PreviewTab = 'html' | 'css' | 'preview';

export const HtmlPreview: React.FC<HtmlPreviewProps> = ({ htmlContent, cssContent, isLoading }) => {
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<PreviewTab>('preview');

    useEffect(() => {
        if (copied) {
            const timer = setTimeout(() => setCopied(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [copied]);

    const handleCopy = async () => {
        const content = activeTab === 'css' ? cssContent : htmlContent;
        if (content) {
            await navigator.clipboard.writeText(content);
            setCopied(true);
        }
    };

    const handleDownload = () => {
        if (htmlContent) {
            // Combine HTML with CSS if separate
            let finalHtml = htmlContent;
            if (cssContent && !htmlContent.includes('<style>')) {
                // Insert CSS into head
                finalHtml = htmlContent.replace('</head>', `<style>\n${cssContent}\n</style>\n</head>`);
            }

            const blob = new Blob([finalHtml], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `design-to-code-${Date.now()}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    const getPreviewHtml = () => {
        if (!htmlContent) return '';
        let finalHtml = htmlContent;
        if (cssContent && !htmlContent.includes('<style>')) {
            finalHtml = htmlContent.replace('</head>', `<style>\n${cssContent}\n</style>\n</head>`);
        }
        return finalHtml;
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-gray-900 rounded-xl border border-gray-800 p-8 text-gray-500 animate-pulse">
                <div className="w-16 h-16 rounded-full bg-gray-800 mb-4"></div>
                <p>Generating HTML/CSS code...</p>
            </div>
        );
    }

    if (!htmlContent) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-gray-900 rounded-xl border border-gray-800 p-8 text-gray-500">
                <FileCode2 className="w-12 h-12 mb-4 opacity-50" />
                <p>Convert SVG to see generated HTML</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-850 z-20 shadow-sm">
                <div className="flex items-center space-x-1">
                    {/* Tabs */}
                    <div className="flex bg-gray-800 rounded-md p-0.5">
                        <button
                            onClick={() => setActiveTab('preview')}
                            className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${activeTab === 'preview'
                                    ? 'bg-amber-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <Eye className="w-3 h-3" />
                            <span>Preview</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('html')}
                            className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${activeTab === 'html'
                                    ? 'bg-amber-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <Code className="w-3 h-3" />
                            <span>HTML</span>
                        </button>
                        {cssContent && (
                            <button
                                onClick={() => setActiveTab('css')}
                                className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${activeTab === 'css'
                                        ? 'bg-amber-600 text-white'
                                        : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                <Palette className="w-3 h-3" />
                                <span>CSS</span>
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    {activeTab !== 'preview' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopy}
                            className="h-8 px-2"
                            title={`Copy ${activeTab.toUpperCase()} Code`}
                        >
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleDownload}
                        className="h-8 text-xs bg-amber-600 hover:bg-amber-700"
                        icon={<Download className="w-4 h-4" />}
                    >
                        Export
                    </Button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'preview' ? (
                    <div className="w-full h-full bg-white">
                        <iframe
                            srcDoc={getPreviewHtml()}
                            className="w-full h-full border-0"
                            title="HTML Preview"
                            sandbox="allow-scripts"
                        />
                    </div>
                ) : (
                    <div className="w-full h-full overflow-auto bg-gray-950 p-4">
                        <pre className="text-sm font-mono text-gray-300 whitespace-pre-wrap break-words">
                            <code>
                                {activeTab === 'css' ? cssContent : htmlContent}
                            </code>
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
};
