"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";
import { useState, type ReactNode } from "react";

interface CoverProps {
    src?: string | null;
    alt: string;
    className?: string;
    priority?: boolean;
    sizes?: string;
    children?: ReactNode;
}

export function Cover({
    src,
    alt,
    className,
    priority = false,
    sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px",
    children,
}: CoverProps) {
    const [erroredSrc, setErroredSrc] = useState<string | null>(null);
    const hasError = Boolean(src) && erroredSrc === src;

    return (
        <div
            className={cn(
                "relative aspect-[2/3] overflow-hidden rounded-sm bg-surface-raised",
                className,
            )}
        >
            {src && !hasError ? (
                <Image
                    src={src}
                    alt={alt}
                    fill
                    sizes={sizes}
                    priority={priority}
                    className="object-cover"
                    onError={() => setErroredSrc(src)}
                    unoptimized
                />
            ) : (
                <div className="flex h-full items-center justify-center">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                        No cover
                    </span>
                </div>
            )}
            {children}
        </div>
    );
}
