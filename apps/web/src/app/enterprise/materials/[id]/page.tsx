"use client";
import { useParams } from 'next/navigation';
import { ResourceEditor } from '@/components/workspace/resource-editor';
export default function Page(){const {id}=useParams<{id:string}>();return <ResourceEditor id={id} kind="materials"/>;}
