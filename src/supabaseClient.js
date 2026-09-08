import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://lmbehxtxgkcrwtwcctgn.supabase.co'
const supabaseKey = 'sb_publishable_dottvRca4ZIna9Uzmf3oHg_SbP_xCnK'

export const supabase = createClient(supabaseUrl, supabaseKey)