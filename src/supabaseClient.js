import { createClient } from '@supabase/supabase-js'
 
const supabaseUrl = 'https://lmbehxtxgkcrwtwcctgn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtYmVoeHR4Z2tjcnd0d2NjdGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTQyNjcsImV4cCI6MjEwNDM3MDI2N30.waSpn8pTIJZKJEAH7X4EJ83WuZENdKkrRRVV-XqZfXw'
 
export const supabase = createClient(supabaseUrl, supabaseKey)
 